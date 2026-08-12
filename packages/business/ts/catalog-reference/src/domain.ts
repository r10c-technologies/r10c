/**
 * The domain name for catalog-reference.
 *
 * One string with three jobs: the `domain` segment of every permission this
 * capability guards (`<domain>:<entityKey>:<action>`, derived from
 * `@entity({ domain, key })`), the key an organization's `Entitlement` lists
 * when it is provisioned for this capability, and the package's own identity.
 * They are the same word on purpose — see
 * [ADR 0005](../../../../../docs/adr/0005-business-domain-decomposition.md).
 *
 * With one deliberate exception, recorded in
 * [ADR 0022](../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md):
 * this domain is **operator-owned and never entitlement-grantable**. An
 * organization is not "provisioned for" the platform's shared vocabulary, and a
 * tenant role that could be minted against it would let a vendor rewrite the
 * browse tree every other vendor is classified into.
 */
export const CATALOG_REFERENCE_DOMAIN = 'catalog-reference';
