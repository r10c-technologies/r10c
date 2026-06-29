import { Entity, EntityLoadRequest } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityLoadRequestTag } from '../../repository/entity-mixins.repository';

export function loadUCFactory<TEntity extends Entity>() {
  return Effect.gen(function* () {
    const entityRepository = yield* EntityRepositoryTag;
    const entityLoadRequest = yield* EntityLoadRequestTag;

    // Type assertion to ensure the load request is of the correct entity type
    // This is necessary because the EntityLoadRequestTag does not carry generic type information
    const typedEntityLoadRequest =
      entityLoadRequest as unknown as EntityLoadRequest<TEntity>;

    const result = yield* entityRepository.load<TEntity>(
      typedEntityLoadRequest
    );
    return result;
  });
}
