import { type Permission, permissionMatches } from './permission';
import { STOCK_DOMAIN } from './role-permissions';

/**
 * What a **service** may do when it crosses into another party's tenant storage
 * — the whole of it, in one list.
 *
 * A platform-plane caller sometimes acts for an organization it was *handed*
 * rather than one it picked: checkout reserving a vendor's stock, where the
 * organization comes from the item and a buyer's session names none. That call
 * presents a service token and an explicit organization, and this table is what
 * decides whether the token may do the thing it is asking to do
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * ⚠️ **Deliberately not part of `ROLE_PERMISSIONS`, and never read by `can()`.**
 * `permissionsOf` expands grants by looking a *role string* up in that table, so
 * a crossing grant living there would be inherited by any access token carrying
 * the matching string — turning a session claim into a cross-organization write.
 * Two tables, two lookups, and the only way to reach this one is
 * {@link serviceCrossingAllows}, which no session guard calls.
 *
 * ⚠️ **No wildcards.** A `*` segment here would make fleet membership itself the
 * capability, which is the distinction the token/permission split exists to
 * draw: the token proves the caller is the fleet, this list says what the fleet
 * may do. Adding a crossing is therefore an explicit line, reviewed as one.
 */
export const SERVICE_CROSSING_PERMISSIONS: readonly Permission[] = [
  // A hold's whole life, and each end of it is its own line. None is a person's
  // act — no role grants them, and the routes that serve them accept no session
  // (ADR 0023).
  //
  // ⚠️ **Three permissions rather than one `reservation:*`.** The wildcard would
  // be shorter and would say something false: a caller that may *release* a hold
  // is giving a claim back and can at worst free stock early, while a caller
  // that may *convert* one consumes the goods and moves `onHand`. Collapsing
  // them makes the weaker act carry the stronger one's authority, which is the
  // same mistake as accepting two credentials on one route.
  `${STOCK_DOMAIN}:reservation:write`,
  `${STOCK_DOMAIN}:reservation:release`,
  `${STOCK_DOMAIN}:reservation:convert`,
];

/**
 * May a caller holding a valid service token exercise this permission?
 *
 * Separate from {@link can} on purpose — see the note above. The comparison
 * still goes through `permissionMatches` rather than `includes`, so a required
 * permission is matched by the same rule everywhere in the system; what differs
 * is only which list is consulted.
 */
export const serviceCrossingAllows = (required: Permission): boolean =>
  SERVICE_CROSSING_PERMISSIONS.some(granted =>
    permissionMatches(granted, required),
  );
