import type { Entity } from '../../../types/Entity';
import { appendMetaUseCase, setMetaUseCaseBinding } from '../../helpers';
import {
  MetaUseCase,
  MetaUseCaseOptions,
} from '../../meta-entities/meta-use-case';

/**
 * Declares a use case: a verb on an entity beyond the `read`/`write`/`delete`
 * triple, with everything a surface needs to render it.
 *
 * It writes twice, and the two writes have different jobs. The descriptor is
 * appended to the **entity's** metadata, because that is what a form, a table or
 * the palette holds. The entity/verb pair is written to the **class's own**
 * metadata, which is what lets `permissionForUseCase(SomeUC)` derive the
 * permission from one argument.
 *
 * The `const` type parameter keeps `key` a literal at the declaration site.
 * Write it inline — `@useCase({ ...DESCRIPTOR })` would compile and would make
 * the source scan in `@r10c/slices` stop seeing the declaration.
 */
export function useCase<const TKey extends string, TEntity extends Entity>(
  options: MetaUseCaseOptions<TKey, TEntity>,
) {
  return (_target: unknown, context: ClassDecoratorContext) => {
    appendMetaUseCase(options.entity, new MetaUseCase(options));
    setMetaUseCaseBinding(context.metadata, {
      entity: options.entity,
      key: options.key,
    });
  };
}
