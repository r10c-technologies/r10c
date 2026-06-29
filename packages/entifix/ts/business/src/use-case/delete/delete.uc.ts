import { Effect } from 'effect';
import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityIdTag } from '../../repository/entity-mixins.repository';

export const deleteUC = Effect.gen(function* () {
  const entityRepository = yield* EntityRepositoryTag;
  const entityId = yield* EntityIdTag;

  yield* entityRepository.delete(entityId);

  return;
});
