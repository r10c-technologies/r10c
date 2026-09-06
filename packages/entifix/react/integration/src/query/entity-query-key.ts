import {
  type Entity,
  type EntityConstructor,
  type EntityLoadRequest,
  envelopeEntityName,
  serializeLoadRequestParams,
} from '@r10c/entifix-ts-core';

/**
 * The TanStack Query cache key for a single entity list request.
 *
 * `['entity', <entity name>, <serialized load request>]` — the entity name
 * (`key ?? name`, the same one every adapter routes on) scopes the key so two
 * different entities never collide, and the RSQL-serialized load request keys
 * each page/filter/sort variant. Reusing {@link serializeLoadRequestParams}
 * means the key changes exactly when the wire request does — the same string
 * the REST adapter already sends.
 */
export type EntityQueryKey = readonly ['entity', string, string];

/** The prefix shared by every query key of an entity — the invalidation scope. */
export type EntityQueryScope = readonly ['entity', string];

/**
 * The invalidation scope from the wire name alone.
 *
 * A constructor is what a table or a form holds; a **string** is what arrives
 * out of band — a record search result, an `EntityChangeEvent` — and neither can
 * produce the other without importing every entity class in the fleet. Splitting
 * the derivation here is what makes "invalidate on the same scope
 * `entityQueryScope` uses" a shared function rather than a convention two call
 * sites happen to follow.
 */
export function entityQueryScopeFor(entity: string): EntityQueryScope {
  return ['entity', entity];
}

export function entityQueryScope<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): EntityQueryScope {
  return entityQueryScopeFor(envelopeEntityName(entityConstructor));
}

export function entityQueryKey<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  request: EntityLoadRequest<TEntity>,
): EntityQueryKey {
  return [
    'entity',
    envelopeEntityName(entityConstructor),
    serializeLoadRequestParams(request).toString(),
  ];
}

/**
 * Matches only the *default* view of an entity's list — first page, no filter,
 * no sort — among the many variants `useDataLoading` caches.
 *
 * ⚠️ **Why an optimistic insert may not use the scope.** `entityQueryScope` is a
 * key *prefix*, and TanStack matches prefixes, so `setQueriesData` against it
 * patches every cached page, filter and sort at once: a filter that excludes the
 * new record would still show it, an unconditional prepend violates whatever
 * sort is applied, and `total` goes wrong on each — which on a list being paged
 * through produces a phantom extra page. The default view is the one place
 * "prepend to the top" is unambiguous; every other variant is corrected by the
 * invalidation on settle, which is the smaller failure (ADR 0043).
 *
 * The key is `[...scope, 'load', page, pageSize, rsql, sort]`, where an absent
 * filter and sort both serialize to `''`. `pageSize` is deliberately not pinned:
 * it is a display preference, not part of what makes a view the default one.
 */
export function isDefaultListQuery<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): (query: { queryKey: readonly unknown[] }) => boolean {
  const entity = envelopeEntityName(entityConstructor);
  return ({ queryKey }) =>
    queryKey[0] === 'entity' &&
    queryKey[1] === entity &&
    queryKey[2] === 'load' &&
    queryKey[3] === 1 &&
    queryKey[5] === '' &&
    queryKey[6] === '';
}
