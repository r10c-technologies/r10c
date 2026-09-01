import {
  type EventBus,
  EventBusTag,
  type TransactionOutbox,
} from '@r10c/entifix-transactions';
import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Context, Duration, Effect } from 'effect';
import type { MongoClient } from 'mongodb';

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
 * Publishes every pending entry, marking each sent as it goes.
 *
 * Delivery is **at-least-once**: a crash between `publish` and `markSent`
 * re-sends the event on the next pass. That is acceptable — and only because
 * the saga tracker's `upsertFromEvent` is an idempotent upsert keyed on
 * `transactionId`, so a redelivered event folds to the same record. A consumer
 * that is not idempotent may not subscribe to this bus.
 *
 * Stops at the first failure rather than skipping ahead, so a broker outage
 * cannot reorder a transaction's `accepted` after its terminal event.
 */
export const drainOutbox = (outbox: TransactionOutbox, bus: EventBus) =>
  Effect.gen(function* () {
    const entries = yield* outbox.pending(BATCH);
    let sent = 0;
    for (const entry of entries) {
      yield* bus.publish(entry.event);
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

  const sweep = Effect.gen(function* () {
    const names = yield* tenantDatabases(client, prefix);
    for (const name of names) {
      const db = client.db(name);
      yield* ensureOutboxIndexes(db);
      yield* drainOutbox(makeMongoOutbox(db), bus);
    }
  }).pipe(
    // A sweep failure must not kill the loop — the next pass retries whatever
    // is still unsent, which is the whole point of a durable outbox.
    Effect.catchAll(() => Effect.void),
    Effect.delay(SWEEP_INTERVAL),
    Effect.forever,
  );

  yield* Effect.forkDaemon(sweep);
});
