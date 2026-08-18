/**
 * **sales-management** — tenant plane, `sales` store.
 *
 * How a vendor sells. Until this domain existed the platform had exactly one
 * implicit channel — the marketplace storefront — and no member anywhere to say
 * so, which meant a vendor selling in their own shop had nowhere to record it
 * and settlement had no way to charge a different rate for a sale it did not
 * source
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * The decisive finding is that TM Forum already answers this, and answers it
 * differently from how it is usually built: an in-store sale is **a channel on
 * the same order**, not a different kind of order. TMF622's `ProductOrder`
 * carries a `RelatedChannel`; TMF676's `Payment` carries one too. So this
 * package adds a vocabulary, not a parallel sales pipeline — `order-management`
 * and `payment-management` keep every entity they had.
 *
 * **Tenant plane**, because a channel is per-vendor and never merges. That is
 * the exact inverse of `catalog-reference`, which is platform plane precisely
 * because a marketplace has to merge brands and categories into one browse tree.
 *
 * What is deliberately **not** here: the till. Cash drawers, shift floats, blind
 * counts and variance have no ODA or SID name — that vocabulary belongs to
 * retail (NRF/ARTS), not telco — so building it would mean inventing every
 * field. Deferred until a vendor asks for cash reconciliation rather than
 * guessed at now. A `PointOfSaleSession` would be a second entity in this same
 * store, so the boundary does not move when it lands.
 *
 * ODA analogue: SID Market/Sales — the Sales Channel ABE (GB922).
 *
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { SALES_DOMAIN } from './domain';
export * from './entities/sales-channel';
export * from './values';
