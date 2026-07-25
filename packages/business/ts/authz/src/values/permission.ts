import {
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';

/** What a caller wants to do with a resource. */
export const Actions = ['read', 'write', 'delete'] as const;
export type Action = (typeof Actions)[number];

/**
 * A permission is three colon-separated segments — `<domain>:<entityKey>:<action>`
 * — so it can be derived from an entity's own `@entity({ domain, key })`
 * metadata rather than maintained as a parallel list. `*` in any segment of a
 * **granted** permission is a wildcard (see {@link permissionMatches}); a
 * **required** permission is always concrete.
 */
export type Permission = `${string}:${string}:${string}`;

/** The `<domain>:<entityKey>` half of a permission — what is being acted on. */
export type Resource = `${string}:${string}`;

const SEGMENT_COUNT = 3;
const WILDCARD = '*';

/** Build a permission from its parts. */
export const permissionFor = (
  domain: string,
  entityKey: string,
  action: Action | typeof WILDCARD,
): Permission => `${domain}:${entityKey}:${action}`;

/** Join a resource and an action into the permission that guards it. */
export const permissionOf = (resource: Resource, action: Action): Permission =>
  `${resource}:${action}`;

/**
 * Derive the permission guarding an entity from the entity itself. This is the
 * point of the `<domain>:<key>:<action>` shape: making a new entity guardable
 * needs no new vocabulary, only its existing `@entity()` metadata.
 */
export const permissionForEntity = <T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  action: Action,
): Permission => {
  const meta = extractMetaEntity(entityConstructor);
  if (meta.domain === undefined || meta.key === undefined) {
    throw new EntifixBuildError(
      `Entity ${entityConstructor.name} needs both a domain and a key to derive a permission`,
    );
  }
  return permissionFor(meta.domain, meta.key, action);
};

/**
 * Split a permission back into the resource + action a policy decision reads.
 * Throws on anything that is not exactly three segments, so a typo in a guard
 * fails at the call site instead of silently denying every request.
 */
export const parsePermission = (
  permission: Permission,
): { resource: Resource; action: Action } => {
  const segments = permission.split(':');
  if (segments.length !== SEGMENT_COUNT) {
    throw new EntifixBuildError(
      `Malformed permission "${permission}" — expected <domain>:<entityKey>:<action>`,
    );
  }
  const [domain, entityKey, action] = segments as [string, string, Action];
  return { resource: `${domain}:${entityKey}`, action };
};

/**
 * Does a granted permission cover a required one? Compared segment by segment,
 * with `*` on the granted side matching anything. `super-admin`'s `*:*:*` thus
 * covers everything, and `product-configuration-management:*:read` covers every
 * entity in that domain without naming them.
 */
export const permissionMatches = (
  granted: Permission,
  required: Permission,
): boolean => {
  const grantedSegments = granted.split(':');
  const requiredSegments = required.split(':');
  if (
    grantedSegments.length !== SEGMENT_COUNT ||
    requiredSegments.length !== SEGMENT_COUNT
  ) {
    return false;
  }
  return grantedSegments.every(
    (segment, index) =>
      segment === WILDCARD || segment === requiredSegments[index],
  );
};
