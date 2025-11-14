import { MetaEntity } from '../../meta-entities/meta-entity';
import type { ClassDecorator } from '../../meta-types';

export function entity<T>() : ClassDecorator<T> {
    return (constructor, context) => {
        const metaEntity = MetaEntity.fromContext(context);

        context.metadata = {
            ...context.metadata,
            entity: metaEntity
        };

        return constructor;
    };
}