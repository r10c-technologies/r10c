import { appendMetaMethod } from '../../helpers';
import { MetaMethod, MetaMethodOptions } from '../../meta-entities/meta-method';

export function method(options?: MetaMethodOptions) {
  return (
    _value: (...args: unknown[]) => unknown,
    context: ClassMethodDecoratorContext
  ) => {
    const meta = new MetaMethod(context.name, options);
    appendMetaMethod(context.metadata, meta);
  };
}
