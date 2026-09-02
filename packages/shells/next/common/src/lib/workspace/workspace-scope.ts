/**
 * Who a persisted workspace belongs to.
 *
 * Tabs and drafts live in IndexedDB, which is a property of the *browser
 * profile*, not of the session. Without a scope two accounts signing in on one
 * machine share both stores: the second sees the first's open tabs and restores
 * their half-finished edits. A draft is keyed by a record's address
 * (`entity:product-specification:<id>`) and a record id is tenant-scoped, so a
 * draft written under one organization and restored under another would post
 * into the wrong tenant.
 *
 * The organization is part of the key for that reason, not only the user: a
 * party may hold several memberships and switching re-mints the token
 * (`TokenClaims.activeOrganizationId`).
 */
export interface WorkspaceScopeParts {
  /** The canonical user id — `TokenClaims.userId`. */
  readonly userId: string;
  /**
   * The organization the session is acting for, when it has one. A buyer and an
   * operator hold no tenant scope at all, which is a legitimate scope of its
   * own rather than a missing value.
   */
  readonly organizationId?: string;
}

/** What an absent `activeOrganizationId` is stored as — see {@link workspaceScopeKey}. */
const NO_ORGANIZATION = '-';

/**
 * The storage key suffix for one signed-in principal.
 *
 * ⚠️ **This is a separation mechanism, not a confidentiality boundary.** Anyone
 * holding the browser profile can read every key in the object store, and they
 * hold the session cookie too — the key stops an accidental cross-account
 * restore, nothing more. It follows that deriving it from unverified token
 * claims is safe: forging one shows you your own drafts under a different name,
 * and every request behind a restored draft is still authorized by the service
 * that answers it. Same reasoning as the nav's `unverifiedRoles`.
 *
 * A session with no organization is scoped explicitly rather than left blank, so
 * `user-1` with no organization and `user-1` acting for organization `-` are not
 * the same workspace by accident.
 */
export function workspaceScopeKey({
  userId,
  organizationId,
}: WorkspaceScopeParts): string {
  return `${userId}:${organizationId ?? NO_ORGANIZATION}`;
}

/**
 * The scope for a visitor whose principal could not be read — an expired cookie
 * behind a page that still rendered, say.
 *
 * It is a real, separate scope rather than an empty string: falling back to the
 * unscoped key would hand an unidentified visitor whatever the last signed-in
 * account left behind, which is the exact failure the scope exists to prevent.
 */
export const ANONYMOUS_WORKSPACE_SCOPE = 'anonymous';
