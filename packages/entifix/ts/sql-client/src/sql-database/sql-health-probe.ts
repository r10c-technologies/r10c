import { SqlClient } from '@effect/sql';
import { HealthRegistryTag } from '@r10c/entifix-ts-business';
import { Effect, Layer } from 'effect';

/** Probe name reported by `/api/health/ready` when the database is unreachable. */
export const SQL_PROBE_NAME = 'postgres';

/**
 * Registers a readiness probe for the connected SQL database.
 *
 * `SELECT 1` rather than "is the pool object there": a connection pool survives
 * a database that has gone away, so only a query that crosses the wire can tell
 * the two apart. For config-service in particular, being reachable while unable
 * to read its table is precisely the state the rest of the fleet needs to hear
 * about — every service resolves its settings from there.
 *
 * Merge it beside the client layer in a service's `AppLayer` and readiness starts
 * reporting the database, with nothing in the service describing the probe — so
 * it cannot drift from the dependency it describes.
 */
export const SqlHealthProbeLayer: Layer.Layer<
  never,
  never,
  SqlClient.SqlClient | HealthRegistryTag
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const registry = yield* HealthRegistryTag;

    yield* registry.register({
      name: SQL_PROBE_NAME,
      check: sql`SELECT 1`.pipe(
        Effect.as(true),
        // Unreachable is a `false`, never a failed endpoint.
        Effect.catchAll(() => Effect.succeed(false)),
      ),
    });
  }),
);
