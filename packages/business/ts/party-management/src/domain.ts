/**
 * The domain name for party-management.
 *
 * One string with three jobs: the `domain` segment of every permission this
 * capability guards (`<domain>:<entityKey>:<action>`, derived from
 * `@entity({ domain, key })`), the key an organization's `Entitlement` lists
 * when it is provisioned for this capability, and the package's own identity.
 * They are the same word on purpose — see
 * [ADR 0005](../../../../../docs/adr/0005-business-domain-decomposition.md).
 */
export const PARTY_DOMAIN = 'party-management';
