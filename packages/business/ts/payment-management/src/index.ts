/**
 * **payment-management** — platform plane, `payment` store.
 *
 * Taking money for an order, and recording how it went.
 *
 * PSP integration is deliberately out of v1 scope, but the slice is **not**
 * deferred with it: without a payment there is no event that converts a stock
 * reservation to a sale, and settlement has no input at all. So v1 lands the
 * {@link Payment} record and a `PaymentProviderTag` port with a simulated
 * adapter — the order state machine and the settlement ledger are real and
 * testable, and swapping in a live provider is a `Layer` at a composition root
 * ([ADR 0022](../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * Authorization and capture stay distinct states because that is what a real
 * provider distinguishes; collapsing them into `paid` now would make the
 * eventual adapter model something this domain cannot express.
 *
 * ODA analogue: Payment Management (TMFC029)
 *
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Out of scope, and named so the silence reads as a decision: stored payment
 * methods, refunds and returns.
 */
export { PAYMENT_DOMAIN } from './domain';
export * from './entities/payment';
export * from './values';
