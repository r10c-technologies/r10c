import { ShutdownRegistryTag } from '@r10c/entifix-ts-business';
import { MongoClientTag } from '@r10c/entifix-ts-mongo-client';
import { Context, Duration, Effect, Fiber } from 'effect';
import type { MongoClient } from 'mongodb';

import {
  RESERVATION_COLLECTION,
  transitionReservation,
} from './reservation-transition';

/** How often the reaper looks for holds nobody finished. */
const SWEEP_INTERVAL = Duration.seconds(30);

/** Holds expired per pass, per tenant database. */
const BATCH = 100;

/** The `stock_` prefix tenant databases are named with, from config-service. */
export class StockDatabasePrefix extends Context.Tag('StockDatabasePrefix')<
  StockDatabasePrefix,
  string
>() {}

/** Every `stock_<organizationId>` this cluster holds. */
const tenantDatabases = (client: MongoClient, prefix: string) =>
  Effect.promise(async () => {
    const { databases } = await client.db().admin().listDatabases();
    return databases
      .map(database => database.name)
      .filter(name => name.startsWith(prefix));
  });

/**
 * Expire one tenant's stale holds.
 *
 * ⚠️ **Through the same conditional write as the release verb**, one hold at a
 * time — not a bulk `updateMany`. Two reasons, and the second is the load-bearing
 * one. A bulk update could not also move `reserved` per offering, so it would
 * strand the counter while the holds looked closed. And a hold being converted
 * at the very moment it expires must resolve to exactly one of the two: the
 * shared filter is `status: 'held'`, so whichever transaction commits first
 * wins and the other matches nothing.
 */
export const sweepTenantReservations = (client: MongoClient, name: string) =>
  Effect.gen(function* () {
    const db = client.db(name);
    const expired = yield* Effect.promise(() =>
      db
        .collection(RESERVATION_COLLECTION)
        .find(
          { status: 'held', expiresAt: { $lt: new Date().toISOString() } },
          { projection: { _id: 0, id: 1 }, limit: BATCH },
        )
        .toArray(),
    );

    for (const { id } of expired as unknown as ReadonlyArray<{
      id: string;
    }>) {
      yield* transitionReservation(client, db, id, 'released').pipe(
        // Per hold, so one row's failure does not abandon every row after it.
        Effect.catchAll(error =>
          Effect.logError('expiring a reservation failed').pipe(
            Effect.annotateLogs({
              database: name,
              reservationId: id,
              error: String(error),
            }),
          ),
        ),
      );
    }

    return expired.length;
  });

/**
 * One pass over every tenant.
 *
 * ⚠️ **A `catchAll` per tenant *and* one around the enumeration.** Without the
 * inner one a single tenant's failure abandons every tenant after it, and the
 * relay this is modelled on records exactly that: the failure is likeliest to
 * be recurring, so the tenants behind it would never be swept again while the
 * sweep went on looking healthy.
 */
export const sweepReservations = (client: MongoClient, prefix: string) =>
  Effect.gen(function* () {
    const names = yield* tenantDatabases(client, prefix);
    for (const name of names) {
      yield* sweepTenantReservations(client, name).pipe(
        Effect.catchAll(error =>
          Effect.logError('sweeping a tenant reservation set failed').pipe(
            Effect.annotateLogs({ database: name, error: String(error) }),
          ),
        ),
      );
    }
  }).pipe(
    // A sweep failure must not kill the loop — the next pass retries whatever
    // is still expired. It is *logged*, though: swallowing it is how a reaper
    // stays dead while every probe stays green, and a dead reaper is stock
    // promised to checkouts nobody finished.
    Effect.catchAll(error =>
      Effect.logError('reservation sweep failed').pipe(
        Effect.annotateLogs({ error: String(error) }),
      ),
    ),
  );

/**
 * The reaper ADR 0010 called for: *"a crashed service leaves stock held until
 * the TTL expires"*, and this is what makes the TTL mean anything.
 *
 * Without it `expiresAt` is a timestamp nothing reads — every abandoned basket
 * promises a vendor's stock permanently, and the symptom is an offering that is
 * quietly unbuyable while its ledger is perfectly correct.
 */
export const startReservationSweep = Effect.gen(function* () {
  const client = yield* MongoClientTag;
  const prefix = yield* StockDatabasePrefix;
  const shutdown = yield* ShutdownRegistryTag;

  const sweepOnce = sweepReservations(client, prefix);

  const daemon = yield* Effect.forkDaemon(
    sweepOnce.pipe(Effect.delay(SWEEP_INTERVAL), Effect.forever),
  );

  // `flush`, so it runs after the handlers have stopped: a sweep racing a live
  // conversion would keep finding holds that handler is still transitioning.
  yield* shutdown.register({
    name: 'reservation-sweep',
    phase: 'flush',
    run: Fiber.interrupt(daemon),
  });
});
