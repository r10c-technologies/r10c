import { redactValue, requireSharedToken } from '@entifix/service-shell';
import { ConfigurationLookupTag } from '@r10c/business-ts-configuration';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { Context, Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

/**
 * Where the configuration store lives, as a connection string. Answered only
 * redacted, so an introspection shows which store this is and no credential.
 */
export class ConfigurationStoreLocationTag extends Context.Service<
  ConfigurationStoreLocationTag,
  string
>()('ConfigurationStoreLocationTag') {}

/** What a host provides for {@link configurationLookupRoutes}. */
export type ConfigurationLookupRouteServices =
  | ConfigurationLookupTag
  | ConfigurationStoreLocationTag;

const unavailable = (error: { readonly message: string }) =>
  HttpServerResponse.json(
    {
      error: 'configuration store unavailable',
      code: 'configUnavailable',
      detail: error.message,
    },
    { status: 500 },
  );

const introspection = Effect.gen(function* () {
  const lookup = yield* ConfigurationLookupTag;
  const location = yield* ConfigurationStoreLocationTag;
  const stats = yield* lookup.stats();
  return yield* HttpServerResponse.json({
    service: '@r10c/config-service',
    store: 'postgres',
    pgUrl: redactValue(location),
    rowCount: stats.rowCount,
    services: stats.services,
  });
}).pipe(Effect.catchTag('EntifixConnError', unavailable));

const lookupForService = Effect.gen(function* () {
  const params = yield* HttpRouter.params;
  const lookup = yield* ConfigurationLookupTag;
  // The route's own `:service` segment: present on every request it serves.
  return yield* HttpServerResponse.json(
    yield* lookup.forService(params.service as string),
  );
}).pipe(Effect.catchTag('EntifixConnError', unavailable));

/**
 * The two routes a booting service and an operator's tooling read the
 * configuration store through:
 *
 * - `GET /api/config/:service` — every row for that service, grouped into
 *   `ConfigurationPlain`, **with real values**: a booting service needs the
 *   actual connection string.
 * - `GET /api/config` — what this store is: its redacted location, how many
 *   rows it holds, and for which services.
 *
 * Both carry credentials or describe where they live, so both are gated on
 * the fleet's shared token rather than on a user's permission. The
 * operator-facing CRUD is {@link configurationRoutes}, which blanks secrets.
 */
export const configurationLookupRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/config',
    requireSharedToken(fleetToken)(introspection),
  ),
  HttpRouter.route(
    'GET',
    '/api/config/:service',
    requireSharedToken(fleetToken)(lookupForService),
  ),
]);
