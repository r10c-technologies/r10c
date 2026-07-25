import { type Permission, permissionMatches } from '../values/permission';
import { isRole } from '../values/role';
import { ROLE_PERMISSIONS } from '../values/role-permissions';

/**
 * Expand a principal's roles into the permissions they grant. Unrecognised
 * roles contribute nothing — an unknown string in a token can never widen
 * access.
 */
export const permissionsOf = (
  roles: readonly string[],
): readonly Permission[] =>
  roles.flatMap(role => (isRole(role) ? ROLE_PERMISSIONS[role] : []));

/**
 * The pure authorization check, shared by every layer: the service guard, the
 * server-rendered nav filter, and the browser. No Effect, no IO — so it runs
 * unchanged in Node, in a Next edge middleware, and in a React component.
 */
export const can = (roles: readonly string[], required: Permission): boolean =>
  permissionsOf(roles).some(granted => permissionMatches(granted, required));
