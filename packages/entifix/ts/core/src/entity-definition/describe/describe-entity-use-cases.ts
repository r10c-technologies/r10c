import { Entity, EntityConstructor } from '../../types/Entity';
import { extractMetaUseCases } from '../helpers';
import type {
  UseCaseBinding,
  UseCaseConfirm,
  UseCasePlacement,
} from '../meta-entities/meta-use-case';

/**
 * An action a caller may take on an entity, resolved from its use-case
 * metadata. The counterpart to {@link EntityFieldDescriptor}, and like it,
 * framework-free and copy-free — every human-readable member is a catalog key.
 *
 * It carries no `entity`: this is the shape that goes over the wire from
 * `GET /api/<entity>/$metadata`, where the entity is already the address.
 */
export interface UseCaseDescriptor {
  /** The verb. Also the third segment of the permission guarding it. */
  key: string;
  binding: UseCaseBinding;
  placement: UseCasePlacement;
  labelKey: string;
  keywordsKey?: string;
  confirm?: UseCaseConfirm;
  form?: string;
}

/**
 * Resolves the use cases declared against an entity, in declaration order.
 *
 * Unlike {@link describeEntityColumns}, this is only trustworthy where the
 * use-case modules have been loaded: a `@useCase()` class registers itself when
 * its module evaluates. On a service that is the composition root's job, and
 * `@r10c/slices` fails the build on a class its package barrel does not export.
 * A browser never calls this — it fetches the descriptors instead, so no
 * use-case implementation reaches a client bundle.
 */
export function describeEntityUseCases<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): UseCaseDescriptor[] {
  return extractMetaUseCases(entityConstructor).map(metaUseCase => ({
    key: metaUseCase.key,
    binding: metaUseCase.binding,
    placement: metaUseCase.placement,
    labelKey: metaUseCase.labelKey,
    keywordsKey: metaUseCase.keywordsKey,
    confirm: metaUseCase.confirm,
    form: metaUseCase.form,
  }));
}
