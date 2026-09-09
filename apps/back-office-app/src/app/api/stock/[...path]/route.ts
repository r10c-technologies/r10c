import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { STOCK_SERVICE_URL } from '@r10c/shells-next-stock/server';

/**
 * Same-origin proxy for stock-service — a vendor's physical availability and
 * the ledger that moves it
 * ([ADR 0010](../../../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * A third proxy rather than a path on `/api/admin`, because these are three
 * backends owned by three slices. **Nothing here is readable anonymously**,
 * unlike the reference vocabulary next door: this is tenant storage, and a
 * vendor's stock position is exactly what a competitor would want — so the
 * proxy exists for every verb, and what makes it work at all is that it carries
 * the httpOnly session cookie upstream.
 *
 * ⚠️ It deliberately does **not** carry a crossing token, and there is no route
 * here that would accept one. `POST /api/reservation` is a service-to-service
 * call authorized by a shared secret and an explicit organization; putting that
 * secret behind a browser-reachable proxy would hand every signed-in tab a
 * cross-organization write capability
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 * The service refuses it regardless — that route takes no session — but the
 * secret has no business being in this process either way.
 */
const forward = createServiceProxyRoute({
  baseUrl: STOCK_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
