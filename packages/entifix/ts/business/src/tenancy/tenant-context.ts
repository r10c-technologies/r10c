import { Context } from 'effect';

/**
 * The organization a request is acting for.
 *
 * Provided **per request**, from the session's `activeOrganizationId` — never
 * from a route parameter or a request body, both of which the caller controls.
 * A request with no organization simply does not provide this tag, and a
 * tenant-plane handler asking for it fails rather than falling back to a shared
 * database.
 */
export class TenantContextTag extends Context.Tag('TenantContextTag')<
  TenantContextTag,
  TenantContext
>() {}

export interface TenantContext {
  /** The `Organization` id every tenant-plane storage name is derived from. */
  readonly organizationId: string;
}
