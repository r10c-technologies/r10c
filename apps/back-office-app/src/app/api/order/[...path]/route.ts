import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { ORDER_SERVICE_URL } from '@r10c/shells-next-order/server';

/**
 * Same-origin proxy for order-service — a buyer's receipts, the lines that say
 * which vendor owes each one, and the two verbs a person can reach.
 *
 * ⚠️ **`GET` and `POST`, and no other method.** This used to be `GET` only, and
 * the reason it gave was sound while it held: every write on the service took a
 * crossing token and no session, so forwarding one would have meant either
 * handing a secret to every signed-in tab or forwarding a session the route
 * refuses anyway.
 *
 * `fulfil` and `cancellation` are what changed it. They are session-guarded by
 * the permissions their own `@useCase()` descriptors derive, so what this
 * carries upstream is exactly the credential they want — and this proxy still
 * grants nothing: order-service verifies the forwarded token and applies its own
 * `requirePermission`
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md) §4).
 *
 * ⚠️ **`PUT`, `PATCH` and `DELETE` stay off deliberately.** `DELETE` upstream is
 * the checkout saga's compensation, behind a crossing token; there is no save
 * route and no role holds `product-order:write`. A method forwarded here that
 * nothing session-guarded serves is a `401` a reader has to go and explain.
 *
 * The buyer's own cancel is **not** reachable through here either. It carries
 * the nonce from a storefront receipt cookie this host never sees, and it is
 * served to the storefront's server action directly.
 */
const forward = createServiceProxyRoute({
  baseUrl: ORDER_SERVICE_URL,
});

export const GET = forward;
export const POST = forward;
