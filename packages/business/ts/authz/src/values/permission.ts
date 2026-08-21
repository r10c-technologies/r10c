import {
  describeEntityUseCases,
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
  extractMetaEntity,
  extractMetaUseCaseBinding,
  type UseCaseConstructor,
} from '@r10c/entifix-ts-core';

/** What a caller wants to do with a resource. */
export const Actions = ['read', 'write', 'delete'] as const;
export type Action = (typeof Actions)[number];

/**
 * A verb declared by `@useCase()` — `publish`, `revoke-sessions`, `approve`.
 *
 * Per-entity and open, rather than one global union every domain appends to:
 * that would make an unrelated domain's verb assignable everywhere and grow
 * without bound. The check that a verb exists is therefore at runtime, in
 * {@link permissionForUseCase}, and in the source scan `@r10c/slices` runs
 * ([ADR 0026](../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 */
export type UseCaseVerb = string;

/**
 * The third segment of a permission: the CRUD triple, or a use-case verb.
 *
 * `Action` stays the narrow three-value union, and every place that guards CRUD
 * keeps using it. This wider alias exists only where a segment has already been
 * parsed off a string and could legitimately be either.
 */
export type PermissionAction = Action | UseCaseVerb;

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

/** Build a permission from its parts. `*` is a legal action on a grant. */
export const permissionFor = (
  domain: string,
  entityKey: string,
  action: PermissionAction,
): Permission => `${domain}:${entityKey}:${action}`;

/** Join a resource and an action into the permission that guards it. */
export const permissionOf = (
  resource: Resource,
  action: PermissionAction,
): Permission => `${resource}:${action}`;

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
 * Derive the permission guarding a use case.
 *
 * The **one-argument** form is what call sites use: a `@useCase()` class knows
 * both the entity it acts on and its own verb, so the verb string is written
 * once — in the decorator — and every guard imports the derived constant instead
 * of retyping it. The **two-argument** form is for a caller that holds only the
 * entity, which is the `$metadata` route walking an entity's descriptors.
 *
 * Both check that the entity really declares the verb, so a typo throws at
 * module load rather than silently denying every request. That check is at
 * runtime because compile-time narrowing does not survive the decorator
 * boundary: `Symbol.metadata` erases types and `extractMetaEntity` hands back an
 * untyped `MetaEntity`. Nothing is lost that existed — `parsePermission` looks
 * like it validates the action segment and does not.
 */
export function permissionForUseCase(useCase: UseCaseConstructor): Permission;
export function permissionForUseCase<T extends Entity>(
  entityConstructor: EntityConstructor<T>,
  key: UseCaseVerb,
): Permission;
export function permissionForUseCase(
  target: UseCaseConstructor | EntityConstructor<Entity>,
  key?: UseCaseVerb,
): Permission {
  const binding =
    key === undefined
      ? extractMetaUseCaseBinding(target as UseCaseConstructor)
      : { entity: target as EntityConstructor<Entity>, key };

  const meta = extractMetaEntity(binding.entity);
  if (meta.domain === undefined || meta.key === undefined) {
    throw new EntifixBuildError(
      `Entity ${binding.entity.name} needs both a domain and a key to derive a permission`,
    );
  }
  const declares = describeEntityUseCases(binding.entity).some(
    useCase => useCase.key === binding.key,
  );
  if (!declares) {
    throw new EntifixBuildError(
      `Entity ${binding.entity.name} does not declare the use case "${binding.key}"`,
    );
  }
  return permissionFor(meta.domain, meta.key, binding.key);
}

/**
 * Split a permission back into the resource + action a policy decision reads.
 * Throws on anything that is not exactly three segments, so a typo in a guard
 * fails at the call site instead of silently denying every request.
 */
export const parsePermission = (
  permission: Permission,
): { resource: Resource; action: PermissionAction } => {
  const segments = permission.split(':');
  if (segments.length !== SEGMENT_COUNT) {
    throw new EntifixBuildError(
      `Malformed permission "${permission}" — expected <domain>:<entityKey>:<action>`,
    );
  }
  // The cast is only the arity the length check above already established. It
  // deliberately does not narrow the action segment: that used to say `Action`,
  // which read as a typo check it never performed, and is now false as well —
  // a use-case verb is a legal third segment.
  const [domain, entityKey, action] = segments as [
    string,
    string,
    PermissionAction,
  ];
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
