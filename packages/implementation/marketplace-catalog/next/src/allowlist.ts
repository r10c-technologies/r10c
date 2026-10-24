import {
  allowedDescriptors,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
} from '@entifix/core';

/**
 * The members of `entity` a query may name for `requirement`, or a throw that
 * names every one that is missing.
 *
 * This is the list marketplace-service checks a request against before it
 * answers, built from the same class. A member that is not on it is rejected
 * `400`, and the storefront renders that as an empty listing and a log line
 * (ADR 0051), which looks exactly like a search that matched nothing. So the
 * storefront asks here at module load, and a facet or a sort on a member that
 * lost its flag fails the build's first test instead.
 */
export const assertQueryable = <TEntity extends Entity>(
  entity: EntityConstructor<TEntity>,
  requirement: 'filterable' | 'sortable',
  members: readonly (keyof TEntity & string)[],
): ReadonlyMap<string, EntityFieldDescriptor> => {
  const allowed = allowedDescriptors(
    entity,
    descriptor => descriptor[requirement],
  );
  const missing = members.filter(member => !allowed.has(member));
  if (missing.length > 0) {
    throw new Error(
      `${entity.name}: ${missing.join(', ')} must be declared ${requirement}`,
    );
  }
  return allowed;
};
