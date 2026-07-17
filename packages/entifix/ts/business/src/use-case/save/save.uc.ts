import { Entity } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityTag } from '../../repository/entity-mixins.repository';

/**
 * Persists an entity and returns whatever the repository considers the stored
 * truth — which is not necessarily the input: a create round-trips through the
 * adapter's id generation, so the returned entity is the one callers should
 * render.
 *
 * Like {@link loadUCFactory}, this yields its inputs from context rather than
 * taking them as arguments, so the same use-case saves over REST on the web and
 * over Mongo on a backend.
 */
export function saveUCFactory<TEntity extends Entity>() {
  return Effect.gen(function* () {
    const entityRepository = yield* EntityRepositoryTag;
    const entity = yield* EntityTag;

    // EntityTag is not generic, so it carries the base `Entity`; the caller
    // states the concrete type through the factory's parameter.
    const result = yield* entityRepository.save<TEntity>(entity as TEntity);

    return result;
  });
}
