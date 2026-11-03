/**
 * The domain name for shipping-order-management.
 *
 * One string with three jobs: the `domain` segment of every permission this
 * capability guards (`<domain>:<entityKey>:<action>`), the key an
 * organization's `Entitlement` lists when it is provisioned to ship, and the
 * package's own identity — the same word on purpose
 * ([ADR 0005](../../../../../docs/adr/0005-business-domain-decomposition.md)).
 * TM Forum's TMF700 Shipping Order names it.
 */
export const SHIPPING_ORDER_DOMAIN = 'shipping-order-management';
