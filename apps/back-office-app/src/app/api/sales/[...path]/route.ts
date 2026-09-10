import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { SALES_SERVICE_URL } from '@r10c/shells-next-sales/server';

/**
 * Same-origin proxy for sales-service — a vendor's selling channels, and the
 * till's one write
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * A fourth proxy rather than a path on an existing one, because these are four
 * backends owned by four slices. Nothing here is readable anonymously: one
 * vendor's counter means nothing to another, and what makes the proxy work at
 * all is that it carries the httpOnly session cookie upstream.
 *
 * ⚠️ **`POST` is here, and it is not the exception the order proxy refuses.**
 * order-service's writes take a crossing token and no session, so putting them
 * behind a browser-reachable proxy would mean forwarding a secret every
 * signed-in tab could then exercise. `POST /api/counter-sale` is the opposite:
 * it takes a **session** and no token, checks
 * `sales-management:sales-channel:sell` against it, and only then presents the
 * coordinator's token itself
 * ([ADR 0056](../../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 */
const forward = createServiceProxyRoute({
  baseUrl: SALES_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
