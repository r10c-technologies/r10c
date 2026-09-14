import { type Permission, permissionMatches } from '../values/permission';

/**
 * Which permissions each role grants.
 *
 * ⚠️ **Supplied by the host, never declared here.** The table that says a `user`
 * may ring up a counter sale is a statement about one product, and a framework
 * that ships one has decided its adopters' business for them. The key is a bare
 * `string` rather than a closed `Role` union for the same reason: a host with
 * roles of its own must be able to name them.
 *
 * A host keeps the strictness it wants on its own side — r10c declares the table
 * as `Record<Role, readonly Permission[]>`, so a typo there is still a compile
 * error where it is written.
 */
export type GrantTable = Readonly<Record<string, readonly Permission[]>>;

/**
 * Expand a principal's roles into the permissions they grant. A role the table
 * does not name contributes nothing — an unknown string in a token can never
 * widen access.
 */
export const permissionsOf = (
  grants: GrantTable,
  roles: readonly string[],
): readonly Permission[] => roles.flatMap(role => grants[role] ?? []);

/**
 * The pure authorization check, shared by every layer: the service guard, the
 * server-rendered nav filter, and the browser. No Effect, no IO — so it runs
 * unchanged in Node, in a Next edge middleware, and in a React component.
 */
export const can = (
  grants: GrantTable,
  roles: readonly string[],
  required: Permission,
): boolean =>
  permissionsOf(grants, roles).some(granted =>
    permissionMatches(granted, required),
  );
