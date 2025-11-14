import type { MethodDecorator } from '../../meta-types';
import { MetaMethod } from '../../meta-entities/meta-method';

export function method(): MethodDecorator {
  return (method, context) => {
    const metaMethod = MetaMethod.fromContext(context);

    context.metadata = {
      ...context.metadata,
      methods: [
        ...((context.metadata?.methods ?? []) as MetaMethod[]),
        metaMethod,
      ],
    };

    return method;
  };
}
