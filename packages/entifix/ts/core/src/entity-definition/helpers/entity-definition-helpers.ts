(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata');

import { Entity, EntityConstructor } from '../../types/Entity';
import { MetaEntity } from '../meta-entities/meta-entity';
import { MetaAccessor } from '../meta-entities/meta-accessor';
import { MetaMethod } from '../meta-entities/meta-method';
import { EntifixBuildError } from '../../base-entities/entifix-error';

declare global {
  interface SymbolConstructor {
    readonly metadata: unique symbol;
  }
  interface Function {
    [Symbol.metadata]?: DecoratorMetadataObject;
  }
}

export const META_ENTITY_KEY = Symbol('MetaEntity');
export const META_ACCESSOR_KEY = Symbol('MetaAccessor');
export const META_METHOD_KEY = Symbol('MetaMethod');

function requireMetadata(
  metadata: DecoratorMetadataObject | undefined
): DecoratorMetadataObject {
  if (!metadata) {
    throw new EntifixBuildError(
      'Decorator metadata unavailable — Symbol.metadata polyfill missing or stage-3 decorator emit not enabled.'
    );
  }
  return metadata;
}

export function setMetaEntity(
  metadata: DecoratorMetadataObject | undefined,
  metaEntity: MetaEntity
) {
  requireMetadata(metadata)[META_ENTITY_KEY] = metaEntity;
}

export function appendMetaAccessor(
  metadata: DecoratorMetadataObject | undefined,
  metaAccessor: MetaAccessor
) {
  const meta = requireMetadata(metadata);
  const existing = (meta[META_ACCESSOR_KEY] as MetaAccessor[] | undefined) ?? [];
  meta[META_ACCESSOR_KEY] = [...existing, metaAccessor];
}

export function appendMetaMethod(
  metadata: DecoratorMetadataObject | undefined,
  metaMethod: MetaMethod
) {
  const meta = requireMetadata(metadata);
  const existing = (meta[META_METHOD_KEY] as MetaMethod[] | undefined) ?? [];
  meta[META_METHOD_KEY] = [...existing, metaMethod];
}

function readMetadata<TEntity extends Entity>(
  target: EntityConstructor<TEntity>
): DecoratorMetadataObject | undefined {
  return target[Symbol.metadata];
}

export function extractMetaEntity<TEntity extends Entity>(
  target: EntityConstructor<TEntity>
): MetaEntity {
  const metadata = readMetadata(target);
  const metaEntity = metadata?.[META_ENTITY_KEY] as MetaEntity | undefined;
  if (!metaEntity) {
    throw new EntifixBuildError(`MetaEntity not found for ${target.name}`);
  }
  return metaEntity;
}

export function extractMetaAccessors<TEntity extends Entity>(
  target: EntityConstructor<TEntity>
): MetaAccessor[] {
  const metadata = readMetadata(target);
  return (metadata?.[META_ACCESSOR_KEY] as MetaAccessor[] | undefined) ?? [];
}

export function extractMetaMethods<TEntity extends Entity>(
  target: EntityConstructor<TEntity>
): MetaMethod[] {
  const metadata = readMetadata(target);
  return (metadata?.[META_METHOD_KEY] as MetaMethod[] | undefined) ?? [];
}
