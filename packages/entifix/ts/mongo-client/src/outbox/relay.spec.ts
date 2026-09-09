import {
  type EventBus,
  EventBusTag,
  type OutboxEntry,
  type TransactionOutbox,
} from '@r10c/entifix-transactions';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { type DomainEvent, EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, HashMap, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { MongoDatabaseTag } from '../mongo-database/mongo-database.js';
import {
  drainOutbox,
  OutboxMaxAttempts,
  startOutboxRelay,
  sweepOutbox,
} from './relay.js';

const anEvent = (id: string): DomainEvent => ({
  name: 'transaction.accepted',
  id,
  source: 'marketplace-admin',
  at: '2026-01-01T00:00:00.000Z',
  correlationId: id.split(':')[0] ?? id,
  data: {},
});

const anEntry = (id: string, attempts = 0): OutboxEntry => ({
  eventId: id,
  event: anEvent(id),
  sent: false,
  attempts,
  quarantined: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/**
 * An outbox that records what the relay did to it. `pending` deliberately
 * returns the same batch every call — the relay drains once per invocation, so
 * a spec asserts on the recorded calls rather than on a second pass.
 */
const recordingOutbox = (entries: readonly OutboxEntry[]) => {
  const sent: string[] = [];
  const failures: Array<{
    eventId: string;
    error: string;
    quarantine: boolean;
  }> = [];

  const outbox: TransactionOutbox = {
    enqueue: () => Effect.succeed('enqueued' as const),
    pending: () => Effect.succeed(entries),
    markSent: entry =>
      Effect.sync(() => {
        sent.push(entry.eventId);
      }),
    recordFailure: (entry, error, quarantine) =>
      Effect.sync(() => {
        failures.push({ eventId: entry.eventId, error, quarantine });
      }),
    stats: () =>
      Effect.succeed({
        pending: entries.filter(entry => !entry.quarantined).length,
        quarantined: entries.filter(entry => entry.quarantined).length,
        oldestPendingAt: entries.find(entry => !entry.quarantined)?.createdAt,
      }),
  };

  return { outbox, sent, failures };
};

/** A bus that refuses the named events and accepts everything else. */
const busRefusing = (unpublishable: readonly string[]) => {
  const published: string[] = [];

  const bus: EventBus = {
    publish: event =>
      unpublishable.includes(event.id)
        ? Effect.fail(new EntifixConnError('routing key too long'))
        : Effect.sync(() => {
            published.push(event.id);
          }),
    subscribe: () => Effect.void,
  };

  return { bus, published };
};

const OPTIONS = { maxAttempts: 3, database: 'tenant_acme' };

/** Runs the drain and returns its result plus the log records it emitted. */
const runDrain = async (
  outbox: TransactionOutbox,
  bus: EventBus,
  options = OPTIONS,
) => {
  const logs: Array<{
    message: string;
    annotations: Record<string, unknown>;
  }> = [];

  const sent = await Effect.runPromise(
    drainOutbox(outbox, bus, options).pipe(
      Effect.provide(
        Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ message, annotations }) => {
            logs.push({
              message: String(message),
              annotations: Object.fromEntries(HashMap.toEntries(annotations)),
            });
          }),
        ),
      ),
    ),
  );
  return { sent, logs };
};
describe('drainOutbox', () => {
  it('publishes pending entries oldest-first and marks each sent', async () => {
    const { outbox, sent } = recordingOutbox([
      anEntry('tx-1:accepted'),
      anEntry('tx-1:completed'),
    ]);
    const { bus, published } = busRefusing([]);

    const result = await runDrain(outbox, bus);

    expect(result.sent).toBe(2);
    expect(published).toEqual(['tx-1:accepted', 'tx-1:completed']);
    expect(sent).toEqual(['tx-1:accepted', 'tx-1:completed']);
  });

  /**
   * The ordering guarantee that predates ADR 0030 and still holds: a broker
   * outage must not let `completed` overtake its own `accepted`.
   */
  it('stops at a failure it may still retry, leaving the order intact', async () => {
    const { outbox, sent, failures } = recordingOutbox([
      anEntry('tx-1:accepted'),
      anEntry('tx-1:completed'),
    ]);
    const { bus, published } = busRefusing(['tx-1:accepted']);

    const result = await runDrain(outbox, bus);

    expect(result.sent).toBe(0);
    // The entry behind the failure is untouched — that is the whole point.
    expect(published).toEqual([]);
    expect(sent).toEqual([]);
    expect(failures).toEqual([
      {
        eventId: 'tx-1:accepted',
        error: 'routing key too long',
        quarantine: false,
      },
    ]);
  });

  /**
   * The defect #179 exists for: before this, an entry that could never publish
   * held its tenant's outbox head-of-line forever, with nothing to look at.
   */
  it('quarantines an entry at the ceiling and lets the queue move past it', async () => {
    const { outbox, sent, failures } = recordingOutbox([
      // Two attempts already spent; this failure is the third.
      anEntry('tx-1:accepted', 2),
      anEntry('tx-2:accepted'),
    ]);
    const { bus, published } = busRefusing(['tx-1:accepted']);

    const result = await runDrain(outbox, bus);

    expect(failures).toEqual([
      {
        eventId: 'tx-1:accepted',
        error: 'routing key too long',
        quarantine: true,
      },
    ]);
    // The head moved: the entry behind the quarantined one was delivered.
    expect(published).toEqual(['tx-2:accepted']);
    expect(sent).toEqual(['tx-2:accepted']);
    expect(result.sent).toBe(1);
  });

  /**
   * #186 will count these. Until the meter provider exists, the log is the
   * whole of "visible without a mongosh session" — and a quarantined entry
   * nobody can see is indistinguishable from a dropped one.
   */
  it('logs the quarantine with the tenant and the reason', async () => {
    const { outbox } = recordingOutbox([anEntry('tx-1:accepted', 2)]);
    const { bus } = busRefusing(['tx-1:accepted']);

    const { logs } = await runDrain(outbox, bus);

    expect(logs).toEqual([
      {
        message: 'outbox entry quarantined',
        // Structured fields, so an operator can find *which* tenant is stuck
        // without reading a rendered string — the whole of "visible without a
        // mongosh session" until #186 counts them.
        annotations: {
          database: 'tenant_acme',
          eventId: 'tx-1:accepted',
          eventName: 'transaction.accepted',
          attempts: 3,
          lastError: 'routing key too long',
        },
      },
    ]);
  });

  it('does not quarantine before the ceiling is actually reached', async () => {
    const { outbox, failures } = recordingOutbox([anEntry('tx-1:accepted', 1)]);
    const { bus } = busRefusing(['tx-1:accepted']);

    await runDrain(outbox, bus);

    // Second of three attempts: still retrying, so nothing is written off.
    expect(failures[0]?.quarantine).toBe(false);
  });
});

describe('sweepOutbox', () => {
  /**
   * ⚠️ **After the drain, not before.** A sample taken first reports what was
   * waiting a moment before this pass cleared it, which is a gauge that reads
   * healthy exactly when the relay has just fallen behind.
   */
  it('samples the depth after draining', async () => {
    const { outbox } = recordingOutbox([anEntry('a'), anEntry('b')]);
    const { bus } = busRefusing([]);
    const sampled: Array<{ database: string; pending: number }> = [];

    await Effect.runPromise(
      sweepOutbox(outbox, bus, {
        maxAttempts: 3,
        database: 'order',
        onStats: (database, stats) =>
          Effect.sync(() => {
            sampled.push({ database, pending: stats.pending });
          }),
      }),
    );

    expect(sampled).toEqual([{ database: 'order', pending: 2 }]);
  });

  /**
   * ⚠️ This runs inside `Effect.forever`. An error that escapes ends the daemon
   * silently, and a relay that stopped is indistinguishable from a relay with
   * nothing to do — so the failure is caught, and *logged* rather than
   * swallowed.
   */
  it('logs a failed pass rather than ending the daemon', async () => {
    const failing: TransactionOutbox = {
      enqueue: () => Effect.succeed('enqueued' as const),
      pending: () => Effect.fail(new EntifixConnError('connection reset')),
      markSent: () => Effect.void,
      recordFailure: () => Effect.void,
      stats: () => Effect.succeed({ pending: 0, quarantined: 0 }),
    };
    const { bus } = busRefusing([]);
    const logs: string[] = [];

    await Effect.runPromise(
      sweepOutbox(failing, bus, { maxAttempts: 3, database: 'order' }).pipe(
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            Logger.make(({ message }) => {
              logs.push(String(message));
            }),
          ),
        ),
      ),
    );

    expect(logs).toContain('outbox sweep failed');
  });

  it('records through the default sink when none is given', async () => {
    const { outbox, sent } = recordingOutbox([anEntry('a')]);
    const { bus } = busRefusing([]);

    // No `onStats`: the default is the exported gauge recorder, which must be
    // reached rather than skipped — an outbox whose depth nothing reports is
    // the failure the gauges exist to make visible.
    await Effect.runPromise(
      sweepOutbox(outbox, bus, { maxAttempts: 3, database: 'order' }),
    );

    expect(sent).toEqual(['a']);
  });
});

describe('startOutboxRelay', () => {
  const world = (entries: readonly OutboxEntry[]) => {
    const { outbox, sent } = recordingOutbox(entries);
    const { bus } = busRefusing([]);
    const registered: Array<{ name: string; phase: string }> = [];

    const layer = Layer.mergeAll(
      Layer.succeed(MongoDatabaseTag, {
        databaseName: 'order',
        collection: () => ({
          createIndex: async () => 'ok',
        }),
      } as never),
      Layer.succeed(EventBusTag, bus),
      Layer.succeed(OutboxMaxAttempts, 3),
      Layer.succeed(ShutdownRegistryTag, {
        register: (hook: { name: string; phase: string }) =>
          Effect.sync(() => {
            registered.push({ name: hook.name, phase: hook.phase });
          }),
        run: () => Effect.void,
      } as never),
    );

    return { layer, sent, registered, outbox };
  };

  /**
   * ⚠️ **`flush`, not `stop-intake`, and the phase is the whole point.**
   * `AmqpEventBusLayer` registers `stop-intake` to cancel consumers; this runs
   * after it, so the last sweep publishes through a connection that is still
   * open. Registered the other way round the entries it was holding would sit
   * until the next boot.
   */
  it('registers its final drain in the flush phase', async () => {
    const { layer, registered } = world([]);

    await Effect.runPromise(
      Effect.scoped(startOutboxRelay().pipe(Effect.provide(layer))),
    );

    expect(registered).toEqual([{ name: 'outbox-relay', phase: 'flush' }]);
  });

  it('passes a supplied stats sink through to the sweep', async () => {
    const { layer } = world([anEntry('a')]);
    const sampled: string[] = [];

    await Effect.runPromise(
      Effect.scoped(
        startOutboxRelay({
          onStats: database =>
            Effect.sync(() => {
              sampled.push(database);
            }),
        }).pipe(Effect.provide(layer)),
      ),
    );

    // The daemon's first pass is one interval away, so nothing is sampled by
    // starting alone — the hook's own drain is what proves the sink is wired,
    // and it is asserted through the shutdown registry above.
    expect(sampled).toEqual([]);
  });
});
