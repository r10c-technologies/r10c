import type { EntityId } from '@r10c/entifix-ts-core';

import type { UserIdentity } from '../entities/user-identity';

/**
 * A credential-verified subject, before a session exists for it. A successful
 * login/registration produces this; the perimeter then mints a session (giving
 * it a `sessionId`) and an access token from it. Structurally it is a
 * {@link Principal} without the `sessionId`, and it is assignable to the
 * entifix `SessionData` the session store persists.
 */
export interface AuthSubject {
  readonly userId: EntityId;
  readonly subject: string;
  readonly roles: readonly string[];
  readonly attributes: Readonly<Record<string, unknown>>;
}

/**
 * Project a canonical {@link UserIdentity} into an {@link AuthSubject}. With own
 * credentials there is no upstream IdP, so `subject` is the canonical user id
 * itself; `displayName`/`status` ride along as attributes for a policy to read
 * without another fetch. Roles are empty in v1 (no role model yet).
 */
export const authSubjectFromUser = (user: UserIdentity): AuthSubject => ({
  userId: user.id,
  subject: String(user.id),
  roles: [],
  attributes: {
    displayName: user.displayName,
    status: user.status,
  },
});
