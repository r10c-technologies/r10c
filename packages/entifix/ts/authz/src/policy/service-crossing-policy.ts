import { Context } from 'effect';

import { type Permission, permissionMatches } from '../values/permission';

/**
 * What a **service** may do when it crosses into another party's tenant storage.
 *
 * ⚠️ **A second port rather than a second method on {@link PolicyDecision}, and
 * the separation is the security property.** `permissionsOf` expands grants by
 * looking a *role string* up in the grant table, so a crossing grant living
 * there would be inherited by any access token carrying the matching string —
 * turning a session claim into a cross-organization write. Two tables, two
 * lookups, and nothing a session guard calls can reach this one
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 */
export interface ServiceCrossingPolicy {
  allows(required: Permission): boolean;
}

/** DI tag the composition root binds to a concrete {@link ServiceCrossingPolicy}. */
export class ServiceCrossingPolicyTag extends Context.Tag(
  'ServiceCrossingPolicyTag',
)<ServiceCrossingPolicyTag, ServiceCrossingPolicy>() {}

/**
 * The allowlist implementation: a host hands over the whole of what its fleet
 * may do, in one list.
 *
 * The comparison goes through `permissionMatches` rather than `includes`, so a
 * required permission is matched by the same rule everywhere in the system;
 * what differs is only which list is consulted.
 *
 * ⚠️ **A host must not put a wildcard in this list.** A `*` segment would make
 * fleet membership itself the capability, which is the distinction the
 * token/permission split exists to draw: the token proves the caller is the
 * fleet, the list says what the fleet may do.
 */
export const makeStaticServiceCrossingPolicy = (
  allowed: readonly Permission[],
): ServiceCrossingPolicy => ({
  allows: required =>
    allowed.some(granted => permissionMatches(granted, required)),
});

/**
 * Refuses every crossing.
 *
 * The right default for an application that has none — an example app, a single
 * service, anything with no saga reaching across a tenant boundary. Supplied
 * explicitly rather than left as a missing Layer, because a missing Layer is a
 * compile error at the composition root and "we do no crossings" deserves to be
 * sayable.
 */
export const NoServiceCrossings: ServiceCrossingPolicy = {
  allows: () => false,
};
