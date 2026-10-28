import {
  mountRoutes,
  redactConfiguration,
  requirePrincipal,
} from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import { Effect } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';

import { fleetFailurePolicy } from './fleet-failure-policy.js';

/**
 * The two routes every r10c service serves beside its own:
 *
 * - `GET /api/config` — this service's loaded parameters, with every credential
 *   redacted. Unauthenticated, which is exactly why an `is_secret` row is the
 *   security boundary rather than a label.
 * - `GET /api/me` — the caller's verified principal, which is how a downstream
 *   service proves it trusts the token auth-service minted.
 *
 * `/api/health*` and `/api/$service` come from the framework's base.
 */
export const serviceBaseRoutes = (options: {
  readonly service: string;
  readonly store: 'mongo' | 'sql';
}) =>
  mountRoutes(
    [
      HttpRouter.route(
        'GET',
        '/api/config',
        Effect.gen(function* () {
          const plain = yield* LoadedConfigurationTag;
          return yield* HttpServerResponse.json({
            service: options.service,
            store: options.store,
            configuration: redactConfiguration(plain),
          });
        }),
      ),
      HttpRouter.route(
        'GET',
        '/api/me',
        requirePrincipal(principal => HttpServerResponse.json(principal)),
      ),
    ],
    fleetFailurePolicy,
  );
