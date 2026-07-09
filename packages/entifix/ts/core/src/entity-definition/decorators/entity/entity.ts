import type { Entity, EntityConstructor } from '../../../types/Entity';
import { setMetaEntity } from '../../helpers';
import { MetaEntity, MetaEntityOptions } from '../../meta-entities/meta-entity';

export function entity<TEntity extends Entity>(options?: MetaEntityOptions) {
  return (
    target: EntityConstructor<TEntity>,
    context: ClassDecoratorContext,
  ) => {
    setMetaEntity(context.metadata, new MetaEntity(target.name, options));
  };
}
