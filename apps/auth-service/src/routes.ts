import { authnRoutes } from '@r10c/implementation-authn-http';
import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * auth-service routes. `/api/health` is added by the service base. The auth
 * endpoints return JSON (tokens + principal); the Next app owns turning that
 * into httpOnly cookies, so this service needs no cookie/CORS handling.
 *
 * Every authn route is the `authn/http` cell's; what it needs from this host —
 * the identity provider's ports over Zitadel, the published key set, the
 * development mailbox — is bound in `AuthnHostLayer`.
 */
export const router = Layer.mergeAll(
  // `GET /api/config` and `GET /api/me` — the second being what a Next server
  // layout reads to decide whether to render the back office and which nav
  // items to show.
  serviceBaseRoutes({ service: '@r10c/auth-service', store: 'mongo' }),
  authnRoutes,
);
