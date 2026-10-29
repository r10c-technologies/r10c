import { defineEndpoint, implement, JsonBody } from '@entifix/core';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import { Context, Effect, Schema } from 'effect';

/**
 * Where the configuration store lives, as a connection string, already
 * redacted by the composition: an introspection shows which store this is and
 * no credential.
 */
export class ConfigurationStoreLocationTag extends Context.Service<
  ConfigurationStoreLocationTag,
  string
>()('ConfigurationStoreLocationTag') {}

const introspection = defineEndpoint({
  name: 'introspection',
  method: 'GET',
  path: '/api/config',
  success: Schema.Struct({
    service: Schema.String,
    store: Schema.Literal('postgres'),
    pgUrl: Schema.String,
    rowCount: Schema.Number,
    services: Schema.Array(Schema.String),
  }),
  errors: [],
  guard: { kind: 'fleet' },
});

const lookup = defineEndpoint({
  name: 'lookup',
  method: 'GET',
  path: '/api/config/:service',
  params: { service: Schema.String },
  success: JsonBody,
  errors: [],
  guard: { kind: 'fleet' },
});

/**
 * The two endpoints a booting service and an operator's tooling read the
 * configuration store through, behind the fleet's shared token rather than a
 * user's permission, because both carry credentials or say where they live:
 *
 * - `GET /api/config/:service` — every row for that service, grouped into
 *   `ConfigurationPlain`, **with real values**: a booting service needs the
 *   actual connection string.
 * - `GET /api/config` — what this store is: its redacted location, how many
 *   rows it holds, and for which services.
 *
 * The operator-facing CRUD is `configurationApi`, which blanks secrets. A
 * store that does not answer is the `unavailable` failure the lookup port
 * raises, and the shell answers it.
 */
export const configurationLookupEndpoints = [
  implement(introspection, () =>
    Effect.gen(function* () {
      const stats = yield* (yield* ConfigurationLookupTag).stats();
      return {
        service: '@r10c/config-service',
        store: 'postgres' as const,
        pgUrl: yield* ConfigurationStoreLocationTag,
        rowCount: stats.rowCount,
        services: stats.services,
      };
    }),
  ),
  implement(lookup, ({ params }) =>
    Effect.flatMap(ConfigurationLookupTag, store =>
      store.forService(params.service),
    ),
  ),
] as const;
