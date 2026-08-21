(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

import { EntifixBuildError } from '../../base-entities/entifix-error';
import { Entity, EntityConstructor } from '../../types/Entity';
import { UseCaseConstructor } from '../../types/UseCase';
import { MetaAccessor } from '../meta-entities/meta-accessor';
import { MetaEntity } from '../meta-entities/meta-entity';
import { MetaMethod } from '../meta-entities/meta-method';
import {
  MetaUseCase,
  MetaUseCaseBinding,
} from '../meta-entities/meta-use-case';

declare global {
  interface SymbolConstructor {
    readonly metadata: unique symbol;
  }
}

export const META_ENTITY_KEY = Symbol('MetaEntity');
export const META_ACCESSOR_KEY = Symbol('MetaAccessor');
export const META_METHOD_KEY = Symbol('MetaMethod');
export const META_USE_CASE_KEY = Symbol('MetaUseCase');
export const META_USE_CASE_BINDING_KEY = Symbol('MetaUseCaseBinding');

function requireMetadata(
  metadata: DecoratorMetadataObject | undefined,
): DecoratorMetadataObject {
  if (!metadata) {
    throw new EntifixBuildError(
      'Decorator metadata unavailable — Symbol.metadata polyfill missing or stage-3 decorator emit not enabled.',
    );
  }
  return metadata;
}

export function setMetaEntity(
  metadata: DecoratorMetadataObject | undefined,
  metaEntity: MetaEntity,
) {
  requireMetadata(metadata)[META_ENTITY_KEY] = metaEntity;
}

export function appendMetaAccessor(
  metadata: DecoratorMetadataObject | undefined,
  metaAccessor: MetaAccessor,
) {
  const meta = requireMetadata(metadata);
  const existing =
    (meta[META_ACCESSOR_KEY] as MetaAccessor[] | undefined) ?? [];
  meta[META_ACCESSOR_KEY] = [...existing, metaAccessor];
}

export function appendMetaMethod(
  metadata: DecoratorMetadataObject | undefined,
  metaMethod: MetaMethod,
) {
  const meta = requireMetadata(metadata);
  const existing = (meta[META_METHOD_KEY] as MetaMethod[] | undefined) ?? [];
  meta[META_METHOD_KEY] = [...existing, metaMethod];
}

/**
 * Append a use case to the metadata of the entity it acts on.
 *
 * This is the one decorator that writes a bag other than its own: a use case is
 * declared on its own class, but the entity is what a surface holds, so the
 * descriptor has to end up there. The consequence is that a use-case module
 * which is never imported leaves the entity looking as if it had no actions,
 * which is why `@r10c/slices` asserts every `@useCase()` class is re-exported
 * from its package barrel.
 *
 * It reads the target's **own** metadata rather than going through
 * {@link readMetadata}. `Symbol.metadata` resolves along the prototype chain, so
 * an inherited read would append the verb to a base class's bag and leak it to
 * every subclass. A target with no own metadata is an entity missing
 * `@entity()`, or a circular import that evaluated the use case first.
 */
export function appendMetaUseCase<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
  metaUseCase: MetaUseCase,
) {
  const own = Object.getOwnPropertyDescriptor(target, Symbol.metadata)
    ?.value as DecoratorMetadataObject | null | undefined;
  if (!own) {
    throw new EntifixBuildError(
      `Use case "${metaUseCase.key}" targets ${target.name}, which has no metadata of its own — it is missing @entity(), or a circular import evaluated the use case first.`,
    );
  }
  const existing = (own[META_USE_CASE_KEY] as MetaUseCase[] | undefined) ?? [];
  own[META_USE_CASE_KEY] = [...existing, metaUseCase];
}

/**
 * Record on the use-case class itself which entity and verb it implements, so
 * the permission can be derived from the class alone. That is what keeps the
 * verb string written once, at the declaration, instead of being retyped at
 * every guard.
 */
export function setMetaUseCaseBinding(
  metadata: DecoratorMetadataObject | undefined,
  binding: MetaUseCaseBinding,
) {
  requireMetadata(metadata)[META_USE_CASE_BINDING_KEY] = binding;
}

function readMetadata<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
): DecoratorMetadataObject | undefined {
  return target[Symbol.metadata] ?? undefined;
}

export function extractMetaEntity<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
): MetaEntity {
  const metadata = readMetadata(target);
  const metaEntity = metadata?.[META_ENTITY_KEY] as MetaEntity | undefined;
  if (!metaEntity) {
    throw new EntifixBuildError(`MetaEntity not found for ${target.name}`);
  }
  return metaEntity;
}

export function extractMetaAccessors<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
): MetaAccessor[] {
  const metadata = readMetadata(target);
  return (metadata?.[META_ACCESSOR_KEY] as MetaAccessor[] | undefined) ?? [];
}

export function extractMetaMethods<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
): MetaMethod[] {
  const metadata = readMetadata(target);
  return (metadata?.[META_METHOD_KEY] as MetaMethod[] | undefined) ?? [];
}

/** Every use case declared against an entity. Empty until one is imported. */
export function extractMetaUseCases<TEntity extends Entity>(
  target: EntityConstructor<TEntity>,
): MetaUseCase[] {
  const metadata = readMetadata(target);
  return (metadata?.[META_USE_CASE_KEY] as MetaUseCase[] | undefined) ?? [];
}

/** The entity and verb a `@useCase()` class implements. */
export function extractMetaUseCaseBinding(
  target: UseCaseConstructor,
): MetaUseCaseBinding {
  const metadata = (
    target as { [Symbol.metadata]?: DecoratorMetadataObject | null }
  )[Symbol.metadata];
  const binding = metadata?.[META_USE_CASE_BINDING_KEY] as
    MetaUseCaseBinding | undefined;
  if (!binding) {
    throw new EntifixBuildError(
      `MetaUseCase not found for ${target.name} — is it missing @useCase()?`,
    );
  }
  return binding;
}
