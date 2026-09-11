import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { SETTLEMENT_SERVICE_URL } from '@r10c/shells-next-settlement/server';

/**
 * Same-origin proxy for settlement-service — a vendor's commercial terms and
 * what they are owed
 * ([ADR 0057](../../../../../../docs/adr/0057-settlement-joins-the-sale-to-its-payment.md)).
 *
 * A fifth proxy rather than a path on an existing one, because these are five
 * backends owned by five slices. Nothing here is readable anonymously, and what
 * makes the proxy work at all is that it carries the httpOnly session cookie
 * upstream — every read behind it is narrowed to whoever that cookie is.
 *
 * ⚠️ **`POST` and `PUT` are here, and neither is the exception the order proxy
 * refuses.** order-service's writes take a crossing token and no session, so
 * putting them behind a browser-reachable proxy would mean forwarding a secret
 * every signed-in tab could then exercise. Every write behind this proxy is the
 * opposite: it takes a **session** and no token, and the grant it checks is held
 * by `super-admin` alone — so the proxy forwards a credential the caller already
 * had rather than one it would be lending them.
 */
const forward = createServiceProxyRoute({
  baseUrl: SETTLEMENT_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
