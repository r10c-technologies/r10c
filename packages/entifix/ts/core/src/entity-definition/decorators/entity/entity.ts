import type { Entity, EntityConstructor } from '../../../types/Entity';
import { MetaEntity, MetaEntityOptions } from '../../meta-entities/meta-entity';
import { setMetaEntity } from '../../helpers';

export function entity<TEntity extends Entity>(options?: MetaEntityOptions) {
  return (
    target: EntityConstructor<TEntity>,
    context: ClassDecoratorContext
  ) => {
    const name = options?.name ?? target.name;
    setMetaEntity(
      context.metadata,
      new MetaEntity(name, { resource: options?.resource })
    );
  };
}
