import { createServiceProxyRoute } from '@r10c/shells-next-common/server';
import { ORDER_SERVICE_URL } from '@r10c/shells-next-order/server';

/**
 * Same-origin proxy for order-service — a buyer's receipts, and the lines that
 * say which vendor owes each one.
 *
 * ⚠️ **`GET` only, and the omission is the point.** The service's two writes
 * take a crossing token and no session; putting them behind a browser-reachable
 * proxy would mean either forwarding a secret every signed-in tab could then
 * exercise, or forwarding a session the route refuses anyway. Neither is worth
 * a route. An order is written by the checkout saga
 * ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)), and
 * `DELETE` there is a compensation rather than a customer-facing cancel.
 *
 * What makes the reads work at all is that this carries the httpOnly session
 * cookie upstream, where `requirePermission` checks
 * `order-management:product-order:read`.
 */
const forward = createServiceProxyRoute({
  baseUrl: ORDER_SERVICE_URL,
});

export const GET = forward;
