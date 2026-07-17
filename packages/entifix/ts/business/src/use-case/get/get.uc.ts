import { Entity } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityIdTag } from '../../repository/entity-mixins.repository';

/**
 * Reads a single entity by id.
 *
 * The factory's type parameter is what makes the result usable without a cast
 * at the call site — {@link EntityIdTag} carries no entity type of its own.
 */
export function getUCFactory<TEntity extends Entity>() {
  return Effect.gen(function* () {
    const entityRepository = yield* EntityRepositoryTag;
    const entityId = yield* EntityIdTag;

    const result = yield* entityRepository.get<TEntity>(entityId);

    return result;
  });
}
