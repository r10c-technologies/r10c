import {
  MetaAccessor,
  MetaAccessorKind,
  MetaAccessorOptions,
} from '../../meta-entities/meta-accessor';
import { appendMetaAccessor } from '../../helpers';

export function accessor(options?: MetaAccessorOptions) {
  return (
    _value: unknown,
    context: ClassGetterDecoratorContext | ClassSetterDecoratorContext
  ) => {
    const kind: MetaAccessorKind =
      context.kind === 'getter' ? 'getter' : 'setter';
    const meta = new MetaAccessor(context.name, kind, options);
    appendMetaAccessor(context.metadata, meta);
  };
}
