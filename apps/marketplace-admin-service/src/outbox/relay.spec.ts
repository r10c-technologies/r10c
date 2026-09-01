import type {
  EventBus,
  OutboxEntry,
  TransactionOutbox,
} from '@r10c/entifix-transactions';
import { type DomainEvent, EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, HashMap, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import { drainOutbox } from './relay';

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
