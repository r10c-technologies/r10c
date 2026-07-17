import { Entity } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityIdTag } from '../../repository/entity-mixins.repository';

/**
 * Deletes an entity by id.
 *
 * The repository contract also accepts a whole entity, but deleting by id is
 * the only shape a caller ever has at the point of deletion (a table row, a
 * route param), so that is what this exposes.
 */
export function deleteUCFactory<TEntity extends Entity>() {
  return Effect.gen(function* () {
    const entityRepository = yield* EntityRepositoryTag;
    const entityId = yield* EntityIdTag;

    yield* entityRepository.delete<TEntity>(entityId);
  });
}
