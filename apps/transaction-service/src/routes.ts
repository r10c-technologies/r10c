import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { requirePrincipal } from '@r10c/shells-effect-service';

import { configIntrospectionRoute } from './routes/config.routes';
import { sagaRoutes } from './saga/routes';
import { sagaRunRoutes } from './saga/run-routes';

/**
 * transaction-service routes. `/api/health*` and `/api/$service` are added by
 * the shell.
 *
 * Two surfaces, and they are different acts. The **reads** — a record by id and
 * the reactive stream — are what a browser watching its own pending write
 * polls and subscribes to; they moved here unchanged from
 * marketplace-admin-service when ADR 0039's `:3103` trigger fired (#229), and
 * both are authenticated and organization-scoped.
 *
 * `POST /api/saga/:definition` is new: it runs a declared multi-step flow. It
 * is generic rather than `/api/checkout` because this slice declares
 * `domains: []` — orchestration is a mechanism, and giving it a business verb
 * would put a domain name in a permission namespace nothing is provisioned for
 * (ADR 0039).
 */
export const router = sagaRunRoutes(
  sagaRoutes(
    HttpRouter.empty.pipe(
      HttpRouter.get('/api/config', configIntrospectionRoute),
      HttpRouter.get(
        '/api/me',
        requirePrincipal(principal => HttpServerResponse.json(principal)),
      ),
    ),
  ),
);
