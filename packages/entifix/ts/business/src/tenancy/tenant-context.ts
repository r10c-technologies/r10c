import { Context } from 'effect';

/**
 * The organization a request is acting for.
 *
 * Provided **per request**, by exactly one of two paths and no third:
 *
 * 1. from the session's `activeOrganizationId` — the only *user-facing*
 *    resolution ([ADR 0006](../../../../../../docs/adr/0006-multitenancy-planes-and-tenant-storage.md));
 * 2. from an **explicit `organizationId`** in the request, when the caller has
 *    presented a valid service token *and* the route carries a narrow
 *    permission ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The second path exists because a platform-plane caller sometimes acts for an
 * organization the principal is not a member of — checkout reserving a vendor's
 * stock, where the organization comes from the *item* and a buyer's session
 * carries none. It is not a hole: the caller-controlled `organizationId` grants
 * nothing on its own, and is only honoured once the caller has proved it is the
 * fleet.
 *
 * There is no fallback and no operator branch. A request satisfying neither path
 * simply does not provide this tag, and a tenant-plane handler asking for it
 * fails rather than reaching a shared database.
 */
export class TenantContextTag extends Context.Tag('TenantContextTag')<
  TenantContextTag,
  TenantContext
>() {}

export interface TenantContext {
  /** The `Organization` id every tenant-plane storage name is derived from. */
  readonly organizationId: string;
}
