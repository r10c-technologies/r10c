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

export function entityQueryScope<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): EntityQueryScope {
  return ['entity', envelopeEntityName(entityConstructor)];
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
