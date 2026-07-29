import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

import { MongoDatabaseTag } from './mongo-database';

/** Probe name reported by `/api/health/ready` when Mongo is unreachable. */
export const MONGO_PROBE_NAME = 'mongo';

/**
 * Registers a readiness probe for the connected database: `admin().ping()`,
 * which is the cheapest round trip the driver offers and, unlike "is the client
 * object non-null", actually crosses the wire.
 *
 * Merge it beside {@link MongoDatabaseLayer} in a service's `AppLayer` and the
 * service's readiness endpoint starts reporting Mongo — nothing in the service
 * describes the probe, so it cannot drift from the dependency it describes.
 */
export const MongoHealthProbeLayer: Layer.Layer<
  never,
  never,
  MongoDatabaseTag | HealthRegistryTag
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* MongoDatabaseTag;
    const registry = yield* HealthRegistryTag;

    yield* registry.register({
      name: MONGO_PROBE_NAME,
      check: Effect.tryPromise(() => db.admin().ping()).pipe(
        Effect.as(true),
        // Unreachable is a `false`, never a failed endpoint.
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    });
  }),
);
