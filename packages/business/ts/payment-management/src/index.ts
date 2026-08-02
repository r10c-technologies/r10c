/**
 * **payment-management** — platform plane.
 *
 * Payment intent and outcome. Ports only for now — no payment service provider
 * is integrated, and the reservation model exists precisely because a payment
 * takes seconds to minutes and cannot be held inside a database transaction.
 *
 * ODA analogue: Payment Management (TMFC029)
 *
 * Governing decision:
 * [ADR 0005](../../../../docs/adr/0005-business-domain-decomposition.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 *
 * Landing next: `Payment`, `PaymentMethod`, and the PSP port.
 * Until then this package exports its domain name, which is already load-bearing
 * (permission namespace, entitlement key, package identity).
 */
export { PAYMENT_DOMAIN } from './domain';
