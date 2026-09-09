import {
  type EventBus,
  EventBusTag,
  type OutboxStats,
  type TransactionOutbox,
} from '@r10c/entifix-transactions';
import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { Context, Duration, Effect, Either, Fiber } from 'effect';

import { MongoDatabaseTag } from '../mongo-database/mongo-database';
import { ensureOutboxIndexes, makeMongoOutbox } from './store';

/** How often the sweep looks for entries the fast path did not carry. */
export const SWEEP_INTERVAL = Duration.seconds(15);
/** Entries drained per pass, per database. */
export const BATCH = 100;

/**
 * Publish attempts an outbox entry gets before it is quarantined, from
 * config-service.
 *
 * Configuration rather than a constant because it is a genuine operational
 * tunable: raising it while a flaky broker settles is a config edit, and the
 * next sweep reads the new value. That is the opposite of a subscription's
 * `maxAttempts`, which becomes an immutable queue argument and therefore stays
 * a literal beside its declaration.
 *
 * ⚠️ **Read it with `getNumber`, never a cast.** A value of `'five'` casts to
 * `NaN`, every `attempts >= maxAttempts` comparison goes false, and nothing is
 * ever quarantined — a relay that looks healthy while its head never moves.
 */
export class OutboxMaxAttempts extends Context.Tag('OutboxMaxAttempts')<
  OutboxMaxAttempts,
  number
>() {}

/** What {@link drainOutbox} needs beyond the ports it publishes through. */
export interface DrainOptions {
  readonly maxAttempts: number;
  /** The database being drained; carried so a quarantine log names it. */
  readonly database: string;
}

/**
 * Publish one batch of pending entries, oldest first, and answer how many went.
 *
 * Two orderings are load-bearing here and neither is obvious:
 *
 * - A **still-deliverable** failure returns immediately rather than continuing.
 *   The entries behind this one keep their order relative to it, which is what
 *   stops a terminal event overtaking the `accepted` for the same transaction.
 * - A **quarantined** failure continues. That is ADR 0030's deliberate
 *   skip-so-the-head-moves: an entry that can never publish must stop blocking
 *   every entry behind it forever.
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
          return sent;
        }

        yield* Effect.logError('outbox entry quarantined').pipe(
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

/** Sample a sweep's depth and age. Supplied by the service that owns the gauges. */
export type OutboxStatsSink = (
  database: string,
  stats: OutboxStats,
) => Effect.Effect<void>;

/**
 * Drain the one database this service owns, then sample its depth.
 *
 * The single-database counterpart to marketplace-admin's tenant walk. A
 * platform-plane store is one named database, so there is nothing to enumerate
 * and `listDatabases` — which needs a `MongoClient` and cluster-wide rights —
 * never comes into it.
 *
 * Stats are sampled **after** the drain, so the gauge reports what is still
 * waiting rather than what was waiting when the pass began.
 *
 * Every failure is caught and logged. This runs inside `Effect.forever`, and an
 * error that escapes ends the daemon silently — a relay that stopped is
 * indistinguishable from a relay with nothing to do.
 */
export const sweepOutbox = (
  outbox: TransactionOutbox,
  bus: EventBus,
  options: DrainOptions & { readonly onStats?: OutboxStatsSink },
) =>
  Effect.gen(function* () {
    yield* drainOutbox(outbox, bus, options);
    if (options.onStats) {
      yield* options.onStats(options.database, yield* outbox.stats());
    }
  }).pipe(
    Effect.catchAll(error =>
      Effect.logError('outbox sweep failed').pipe(
        Effect.annotateLogs({
          database: options.database,
          error: String(error),
        }),
      ),
    ),
  );

/**
 * Start the relay for a service that owns exactly one database.
 *
 * ⚠️ **The shutdown hook is `flush`, not `stop-intake`, and the phase is the
 * whole point.** `AmqpEventBusLayer` registers `stop-intake` to cancel consumers
 * and drain deliveries; this runs after that, so the last sweep publishes into a
 * connection that is still open. Registered the other way round it would try to
 * publish through a channel already closing, and the entries it was holding
 * would sit until the next boot.
 *
 * The daemon is `delay |> forever`, so the first sweep is one interval away
 * rather than at boot — the write path drains inline, and a sweep racing the
 * index bootstrap on a cold database only produces noise.
 */
export const startOutboxRelay = (options?: {
  readonly onStats?: OutboxStatsSink;
}) =>
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const bus = yield* EventBusTag;
    const maxAttempts = yield* OutboxMaxAttempts;
    const shutdown = yield* ShutdownRegistryTag;

    yield* ensureOutboxIndexes(db);
    const outbox = makeMongoOutbox(db);

    const sweepOnce = sweepOutbox(outbox, bus, {
      maxAttempts,
      database: db.databaseName,
      ...(options?.onStats ? { onStats: options.onStats } : {}),
    });

    const daemon = yield* Effect.forkDaemon(
      sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
    );

    yield* shutdown.register({
      name: 'outbox-relay',
      phase: 'flush',
      run: Fiber.interrupt(daemon).pipe(Effect.andThen(sweepOnce)),
    });
  });
