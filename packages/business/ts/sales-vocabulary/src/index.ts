/**
 * **sales-vocabulary** — the channel types, and nothing else.
 *
 * `business:policy`, the role `business-ts-authz` plays for permissions: a
 * vocabulary several domains express themselves in, depended on by any of them
 * and depending on none.
 *
 * It exists because three packages need the same closed set and no two of them
 * may see each other. `sales-management` owns the `SalesChannel` a type
 * describes; `settlement-management` prices a line by that type; and
 * `order-management`'s `RelatedChannel` carries it onto the receipt. A
 * `business:domain` package may never depend on another, so before this package
 * the set was **declared once and copied twice** — `CommissionableChannelTypes`
 * was a byte-identical duplicate, and `RelatedChannel.type` was a bare `string`
 * because there was no legal way to name the union
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)
 * recorded both as the cost, with this package as the fix if it ever bit).
 *
 * What made it bite is the counter sale actually being built: a type now travels
 * from a vendor's channel record, through the saga, onto an order and into a
 * commission — four hops across three domains, on a set nothing kept in step. A
 * type added in one list and not the other silently became unpriceable and fell
 * through to the agreement's default rate, which is a wrong invoice rather than
 * an error ([ADR 0056](../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 *
 * ⚠️ **Vocabulary only — it declares no `*_DOMAIN` constant and never will.** A
 * domain constant here would have to be claimed by a slice, and this package
 * owns no store and no entity. Nothing that could be an entity belongs in it.
 */
export * from './values';
