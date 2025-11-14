import type {
  AccessorDecorator,
  GetterDecoratorContext,
  SetterDecoratorContext,
} from '../../meta-types';
import { MetaAccessor } from '../../meta-entities/meta-accessor';

export function accessor(): AccessorDecorator {
  return (accessor, context) => {
    let metaAccessor = (
      (context.metadata?.accessors ?? []) as MetaAccessor[]
    ).find(a => a.name === context.name);

    if (!metaAccessor) {
      metaAccessor = MetaAccessor.fromContext(context);
      context.metadata = {
        ...context.metadata,
        accessors: [
          ...((context.metadata?.accessors ?? []) as MetaAccessor[]),
          metaAccessor,
        ],
      };
    } else if (context.kind === 'getter') {
      metaAccessor.getter = MetaAccessor.fromGetContext(
        context as GetterDecoratorContext
      );
    } else if (context.kind === 'setter') {
      metaAccessor.setter = MetaAccessor.fromSetContext(
        context as SetterDecoratorContext
      );
    }

    return accessor;
  };
}
