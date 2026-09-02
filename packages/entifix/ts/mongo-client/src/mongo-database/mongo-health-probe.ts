import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { MongoClientTag } from './mongo-database';

/** Probe name reported by `/api/health/ready` when Mongo is unreachable. */
export const MONGO_PROBE_NAME = 'mongo';

/**
 * Registers a readiness probe for the Mongo **connection**: `admin().ping()`,
 * which is the cheapest round trip the driver offers and, unlike "is the client
 * object non-null", actually crosses the wire.
 *
 * It depends on {@link MongoClientTag}, not on a named database, because the
 * ping targets the `admin` database and never touches the connected one — so a
 * service whose handles are all per-request (tenant storage) does not have to
 * invent a database name to become observable. Naming one it never writes is
 * exactly the phantom store ADR 0020 rules out.
 *
 * Merge it beside {@link MongoClientLayer} in a service's `AppLayer` and the
 * service's readiness endpoint starts reporting Mongo — nothing in the service
 * describes the probe, so it cannot drift from the dependency it describes.
 *
 * `stores` names the Stores this connection backs, by their register name in
 * `tools/slices/` — `['catalog', 'saga']`, never a database name and never a
 * URI. It is the composition root's to supply because a client package cannot
 * know it, and it is a list because one connection routinely backs several
 * Stores (ADR 0031).
 */
export const MongoHealthProbeLayer = (
  stores: readonly string[],
): Layer.Layer<never, never, MongoClientTag | HealthRegistryTag> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const client = yield* MongoClientTag;
      const registry = yield* HealthRegistryTag;

      yield* registry.register({
        name: MONGO_PROBE_NAME,
        kind: 'datastore',
        targets: stores,
        check: Effect.tryPromise(() =>
          client.db('admin').command({ ping: 1 }),
        ).pipe(
          Effect.as(true),
          // Unreachable is a `false`, never a failed endpoint.
          Effect.catchAll(() => Effect.succeed(false)),
        ),
      });
    }),
  );
