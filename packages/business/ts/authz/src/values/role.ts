/**
 * The role aspect attached to every user. Deliberately a small, ordered set
 * rather than free-form strings: it is the one attribute that rides in the
 * access token, and an ordered tier is what makes the escalation rule
 * ("assign at or below your own tier") expressible without a policy language.
 */
export const Roles = ['user', 'admin', 'super-admin'] as const;
export type Role = (typeof Roles)[number];

/** Default for a self-registered account; never assignable by the caller. */
export const DEFAULT_ROLE: Role = 'user';

/** Seniority. Higher wins; only used for the assignment rule, not for grants. */
export const ROLE_RANK: Record<Role, number> = {
  user: 0,
  admin: 1,
  'super-admin': 2,
};

/** Narrow an unknown value (a request body, a Mongo document) to a {@link Role}. */
export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (Roles as readonly string[]).includes(value);

/**
 * The highest rank among the roles a principal carries, or `-1` when it carries
 * none (or only unrecognised ones) — which can never satisfy an assignment.
 */
export const highestRank = (roles: readonly string[]): number =>
  roles.reduce(
    (rank, role) => (isRole(role) ? Math.max(rank, ROLE_RANK[role]) : rank),
    -1,
  );

/**
 * May an actor create or promote someone to `target`? At or below the actor's
 * own tier — so an admin mints admins and users but never a super-admin, and an
 * unauthenticated signup (no roles) can mint nothing.
 */
export const canAssignRole = (
  actorRoles: readonly string[],
  target: Role,
): boolean => highestRank(actorRoles) >= ROLE_RANK[target];
