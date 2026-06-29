import { Effect } from 'effect';
import { EntityRepositoryTag } from '../../repository/entity.repository';
import { EntityTag } from '../../repository/entity-mixins.repository';

export const saveUC = Effect.gen(function* () {
  const entityRepository = yield* EntityRepositoryTag;
  const entity = yield* EntityTag;

  const result = yield* entityRepository.save(entity);

  return result;
});
