import { defineRoleLadder, type RoleOf } from '@entifix/authz';

/**
 * r10c's role ladder, lowest rung first — the one place it is declared.
 *
 * entifix keeps the rule — assign at or below your own rank, and nothing
 * without a recognised role — and the host supplies the rungs
 * ([entifix ADR 0007](https://github.com/r10c-technologies/entifix/blob/v0.7.2/docs/adr/0007-the-host-supplies-the-role-ladder.md)).
 * It lives beside {@link ROLE_PERMISSIONS} because the two are one decision: a
 * rung with no grants is a role that can do nothing, and a grant keyed on a role
 * the ladder lacks is dead.
 *
 * Re-exported under the names the framework used to ship, so a caller changes
 * where it imports from and nothing else.
 */
export const ROLE_LADDER = defineRoleLadder([
  'user',
  'admin',
  'super-admin',
] as const);

export type Role = RoleOf<typeof ROLE_LADDER>;

export const Roles = ROLE_LADDER.roles;

/** What a self-registered account starts as; never assignable by the caller. */
export const DEFAULT_ROLE = ROLE_LADDER.defaultRole;

export const { canAssignRole, highestRank, isRole } = ROLE_LADDER;
