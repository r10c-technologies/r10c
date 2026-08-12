/**
 * **party-management** — control plane.
 *
 * The party registry: `Organization` (the tenant), `Individual`, and the
 * `PartyRole`s a party plays (`vendor`, `customer`, `operator`). SID makes a role
 * something a party *plays* rather than something it *is*, which is what lets one
 * organization be a marketplace vendor here and a CRM customer later.
 *
 * ODA analogue: Party Management (TMFC028)
 *
 * Governing decision:
 * [ADR 0005](../../../../docs/adr/0005-business-domain-decomposition.md), with
 * the tenancy consequences in
 * [ADR 0006](../../../../docs/adr/0006-multitenancy-planes-and-tenant-storage.md).
 * The capability map is in
 * [BUSINESS-ARCHITECTURE.md](../../../../docs/BUSINESS-ARCHITECTURE.md).
 */
export { PARTY_DOMAIN } from './domain';
export * from './entities/individual';
export * from './entities/organization';
export * from './entities/party-role';
export * from './values';
