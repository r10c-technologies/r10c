import {
  type EventBus,
  EventBusTag,
  type TransactionOutbox,
} from '@r10c/entifix-transactions';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Context, Duration, Effect, Either, Fiber } from 'effect';
import type { MongoClient } from 'mongodb';

import { recordOutboxStats } from '../observability/metrics';
import { ensureOutboxIndexes, makeMongoOutbox } from './store';

/** How often the sweep looks for entries the fast path did not carry. */
const SWEEP_INTERVAL = Duration.seconds(15);
/** Entries drained per pass, per database. */
const BATCH = 100;

/** The `tenant_` prefix tenant databases are named with, from config-service. */
export class TenantDatabasePrefix extends Context.Tag('TenantDatabasePrefix')<
  TenantDatabasePrefix,
  string
>() {}

/**
 * Publish attempts an outbox entry gets before it is quarantined, from
 * config-service.
 *
 * Configuration rather than a constant because it is a genuine operational
 * tunable: raising it while a flaky broker settles is a config edit, and the
 * next sweep reads the new value. That is the opposite of a subscription's
 * `maxAttempts`, which becomes an immutable queue argument and therefore stays
 * a literal beside its declaration.
 */
export class OutboxMaxAttempts extends Context.Tag('OutboxMaxAttempts')<
  OutboxMaxAttempts,
  number
>() {}

/** What {@link drainOutbox} needs beyond the ports it publishes through. */
export interface DrainOptions {
  readonly maxAttempts: number;
  /** The tenant database being drained; carried so a quarantine log names it. */
  readonly database: string;
}

/**
 * Publishes every pending entry, marking each sent as it goes.
 *
 * Delivery is **at-least-once**: a crash between `publish` and `markSent`
 * re-sends the event on the next pass. That is acceptable — and only because
 * the saga tracker's `upsertFromEvent` is an idempotent upsert keyed on
 * `transactionId`, so a redelivered event folds to the same record. A consumer
 * that is not idempotent may not subscribe to this bus.
 *
 * Stops at the first failure rather than skipping ahead, so a broker outage
 * cannot reorder a transaction's `accepted` after its terminal event — **until**
 * an entry has spent `maxAttempts`. Past the ceiling it is quarantined and
 * skipped, because the ordering guarantee is only worth having between entries
 * that can still be delivered: one that never can was holding the whole tenant's
 * outbox behind it, forever and invisibly (ADR 0030).
 *
 * Quarantining logs rather than counting. The count is #186's, and it needs a
 * meter provider that does not exist yet; a log reaches Loki today, and a
 * quarantined entry nobody can see is indistinguishable from a dropped one.
 */
export const drainOutbox = (
  outbox: TransactionOutbox,
  bus: EventBus,
  options: DrainOptions,
) =>
  Effect.gen(function* () {
    const entries = yield* outbox.pending(BATCH);
    let sent = 0;
    for (const entry of entries) {
      const outcome = yield* Effect.either(bus.publish(entry.event));

      if (Either.isLeft(outcome)) {
        const attempts = entry.attempts + 1;
        const quarantine = attempts >= options.maxAttempts;

        yield* outbox.recordFailure(entry, outcome.left.message, quarantine);

        if (!quarantine) {
          // Still deliverable. Stop here so the entries behind this one keep
          // their order relative to it.
          return sent;
        }

        yield* Effect.logError('outbox entry quarantined').pipe(
          // Annotations, not extra message arguments: the tooling logger emits
          // these as structured fields, so the tenant and the event id are
          // queryable in Loki rather than buried in a rendered string.
          Effect.annotateLogs({
            database: options.database,
            eventId: entry.eventId,
            eventName: entry.event.name,
            attempts,
            lastError: outcome.left.message,
          }),
        );
        continue;
      }

      yield* outbox.markSent(entry);
      sent += 1;
    }
    return sent;
  });

/**
 * Every tenant database this slice owns.
 *
 * Enumerating is legal here and nowhere else: `marketplace-admin` is the single
 * writing slice of every `tenant_<organizationId>` store, so the relay is
 * reading its own. A slice that does not own a store may not do this.
 */
const tenantDatabases = (client: MongoClient, prefix: string) =>
  Effect.tryPromise({
    try: async () => {
      const { databases } = await client.db('admin').admin().listDatabases();
      return databases
        .map(database => database.name)
        .filter(name => name.startsWith(prefix));
    },
    catch: () => new Error('failed to list tenant databases'),
  });

/**
 * The slow half of the two-speed relay.
 *
 * The fast half is {@link drainOutbox} called by the request that just
 * committed — it already holds the tenant handle, so the normal case reaches
 * the bus with the latency it had before the outbox existed. This sweep exists
 * for what the fast path cannot cover: the process died after commit, or the
 * broker was down when it ran.
 *
 * It reads from the **primary**, which is the driver's default and must stay
 * that way. A secondary read could return an entry whose `sent` flag has not
 * replicated yet and publish it a second time — harmless given at-least-once,
 * but pure waste, and it would make the duplicate rate a function of
 * replication lag.
 */
export const startOutboxRelay = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const bus = yield* EventBusTag;
  const prefix = yield* TenantDatabasePrefix;
  const maxAttempts = yield* OutboxMaxAttempts;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = Effect.gen(function* () {
    const names = yield* tenantDatabases(client, prefix);
    for (const name of names) {
      const db = client.db(name);
      yield* ensureOutboxIndexes(db);
      const outbox = makeMongoOutbox(db);
      yield* drainOutbox(outbox, bus, { maxAttempts, database: name });
      // Sampled **after** the drain, so the gauge reports what is still waiting
      // rather than what was waiting a moment before this pass cleared it.
      // Here rather than on its own timer because this loop already enumerates
      // every tenant database once per sweep.
      yield* recordOutboxStats(name, yield* outbox.stats());
    }
  }).pipe(
    // A sweep failure must not kill the loop — the next pass retries whatever
    // is still unsent, which is the whole point of a durable outbox. It is
    // *logged*, though: swallowing it silently is how an `ensureOutboxIndexes`
    // conflict, or a tenant enumeration that stopped working, would leave the
    // relay dead while every probe stayed green.
    Effect.catchAll(error =>
      Effect.logError('outbox sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

  const daemon = yield* Effect.forkDaemon(
    sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
  );

  // `flush`, so it runs after the consumers have stopped: a sweep racing a live
  // handler would keep finding entries that handler is still writing.
  //
  // Interrupting the daemon first is what stops two sweeps publishing the same
  // entry; running one more afterwards is what this hook is *for*. Without it
  // an event committed a moment before SIGTERM waits out the next process's
  // 15s interval, and the browser watching the transaction sees `PENDING` for a
  // rollout that actually succeeded.
  yield* shutdown.register({
    name: 'outbox-relay',
    phase: 'flush',
    run: Fiber.interrupt(daemon).pipe(Effect.andThen(sweepOnce)),
  });
});
