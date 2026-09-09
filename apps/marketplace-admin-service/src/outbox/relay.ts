import { type EventBus, EventBusTag } from '@r10c/entifix-transactions';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import {
  drainOutbox,
  ensureOutboxIndexes,
  makeMongoOutbox,
  MongoClientTag,
  OutboxMaxAttempts,
  recordOutboxStats,
  SWEEP_INTERVAL,
} from '@r10c/entifix-ts-mongo-client';
import { Context, Effect, Fiber } from 'effect';
import type { MongoClient } from 'mongodb';

/** The `tenant_` prefix tenant databases are named with, from config-service. */
export class TenantDatabasePrefix extends Context.Tag('TenantDatabasePrefix')<
  TenantDatabasePrefix,
  string
>() {}

/**
 * Every tenant database this slice owns.
 *
 * Enumerating is legal here and nowhere else: `marketplace-admin` is the single
 * writing slice of every `tenant_<organizationId>` store, so the relay is
 * reading its own. A slice that does not own a store may not do this.
 */
export const tenantDatabases = (client: MongoClient, prefix: string) =>
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
export const sweepTenantOutboxes = (
  client: MongoClient,
  bus: EventBus,
  options: { readonly prefix: string; readonly maxAttempts: number },
) => {
  const { prefix, maxAttempts } = options;

  return Effect.gen(function* () {
    const names = yield* tenantDatabases(client, prefix);
    for (const name of names) {
      // ⚠️ **Per tenant, not per pass.** The `catchAll` below covers the
      // enumeration; without this one, a single tenant's failure abandons every
      // tenant after it — and the failure this is likeliest to be is the
      // `IndexOptionsConflict` `ensureOutboxIndexes` documents, which recurs on
      // every sweep, so the tenants behind it would never drain again while the
      // relay went on looking healthy.
      yield* Effect.gen(function* () {
        const db = client.db(name);
        yield* ensureOutboxIndexes(db);
        const outbox = makeMongoOutbox(db);
        yield* drainOutbox(outbox, bus, { maxAttempts, database: name });
        // Sampled **after** the drain, so the gauge reports what is still
        // waiting rather than what was waiting a moment before this pass
        // cleared it. Here rather than on its own timer because this loop
        // already enumerates every tenant database once per sweep.
        yield* recordOutboxStats(name, yield* outbox.stats());
      }).pipe(
        Effect.catchAll(error =>
          Effect.logError('draining a tenant outbox failed').pipe(
            Effect.annotateLogs({ database: name, error: String(error) }),
          ),
        ),
      );
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
};

/**
 * Runs {@link sweepTenantOutboxes} on a timer and drains once more on the way
 * out.
 *
 * The pass is a separate function so it can be asserted without a broker, a
 * driver or a fiber — the same split {@link drainOutbox} already has, and the
 * only way to state "one tenant's failure does not take the next tenant's" as a
 * test rather than as a comment.
 */
export const startOutboxRelay = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const bus = yield* EventBusTag;
  const prefix = yield* TenantDatabasePrefix;
  const maxAttempts = yield* OutboxMaxAttempts;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = sweepTenantOutboxes(client, bus, { prefix, maxAttempts });

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
