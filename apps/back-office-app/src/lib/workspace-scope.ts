import { unverifiedClaims } from '@r10c/entifix-ts-jwt-client';
import {
  ANONYMOUS_WORKSPACE_SCOPE,
  workspaceScopeKey,
} from '@r10c/shells-next-common';
import { cookies } from 'next/headers';

/** The access cookie this host sets at the end of the OIDC callback. */
const AT_COOKIE = 'r10c_at';

/**
 * Which persisted workspace this visitor gets — their open tabs and autosaved
 * drafts.
 *
 * Read out of the access cookie **without verifying its signature**, for the
 * same reason and with the same safety as `navRoles`: the value decides which
 * IndexedDB key is read, not what anyone may reach. Forging the cookie would
 * show you a different set of your own browser's drafts, and every request
 * behind a restored draft still goes to the owning service, which verifies the
 * token properly. Never branch on this for access.
 *
 * The organization is part of the key, not only the user: a party may hold
 * several memberships, a record id is tenant-scoped, and a draft carried across
 * a switch would be submitted into the wrong tenant.
 */
export async function workspaceScope(): Promise<string> {
  const claims = unverifiedClaims(
    (await cookies()).get(AT_COOKIE)?.value ?? '',
  );
  if (claims?.userId == null) return ANONYMOUS_WORKSPACE_SCOPE;

  return workspaceScopeKey({
    userId: String(claims.userId),
    organizationId: claims.activeOrganizationId,
  });
}
