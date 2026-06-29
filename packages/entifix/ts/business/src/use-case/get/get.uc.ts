import { Effect } from 'effect';
import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityIdTag } from '../../repository/entity-mixins.repository';

export const getUC = Effect.gen(function* () {
  const entityRepository = yield* EntityRepositoryTag;
  const entityId = yield* EntityIdTag;

  const result = yield* entityRepository.get(entityId);

  return result;
});
