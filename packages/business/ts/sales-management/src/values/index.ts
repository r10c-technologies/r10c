export * from './sales-channel-status';
/**
 * The channel types are re-exported rather than declared here: they live in
 * `@r10c/business-ts-sales-vocabulary` so `settlement-management` and
 * `order-management` can name the same closed set without importing this
 * domain, which the boundary rule forbids
 * ([ADR 0056](../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 * A caller holding this package still gets everything its entity's members are
 * typed in.
 */
export * from '@r10c/business-ts-sales-vocabulary';
