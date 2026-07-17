import { Entity, EntityConstructor } from '../../types/Entity';
import { extractMetaAccessors } from '../helpers';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';

/**
 * A plain, JSON-safe representation of an entity — the inverse of
 * {@link buildEntityInstance}. Relations collapse to the shape the deserializer
 * expects to round-trip:
 * - an {@link EntityLink} → the embedded plain object when loaded, otherwise the
 *   scalar foreign-key id.
 * - an {@link EntityCollectionLink} → an array mixing embedded objects (loaded)
 *   or scalar ids.
 *
 * This one serialization serves both persistence (entity → Mongo document) and
 * transport (entity → HTTP wire shape), so a value written by an adapter reads
 * back identically through {@link deserializeSingleEntity}.
 */
export type SerializedEntity = Record<string, unknown>;

function serializeLink<TEntity extends Entity>(
  link: EntityLink<TEntity>,
): unknown {
  if (link.isLoaded && link.value !== undefined) {
    return serializeEntity(link.entityConstructor, link.value);
  }
  return link.id ?? undefined;
}

function serializeCollectionLink<TEntity extends Entity>(
  link: EntityCollectionLink<TEntity>,
): unknown {
  if (link.isLoaded && link.values !== undefined) {
    return link.values.map(value =>
      serializeEntity(link.entityConstructor, value),
    );
  }
  const ids = link.ids;
  return ids.length > 0 ? ids : undefined;
}

/**
 * Serializes an entity instance into a plain object, walking the same accessor
 * metadata the deserializer reads (getter-kind, not hidden/readonly), keyed by
 * `alias ?? name`. `undefined` values are omitted so absent optionals and
 * unresolved relations don't pollute the output.
 */
export function serializeEntity<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  instance: TEntity,
): SerializedEntity {
  const result: SerializedEntity = {};

  extractMetaAccessors(entityConstructor)
    .filter(
      metaAccessor =>
        !metaAccessor.hidden &&
        !metaAccessor.readonly &&
        metaAccessor.kind === 'getter',
    )
    .forEach(metaAccessor => {
      const propertyName = metaAccessor.alias ?? metaAccessor.name;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const value = (instance as any)[metaAccessor.name];

      let serialized: unknown;
      if (value instanceof EntityLink) {
        serialized = serializeLink(value);
      } else if (value instanceof EntityCollectionLink) {
        serialized = serializeCollectionLink(value);
      } else {
        serialized = value;
      }

      if (serialized !== undefined) {
        result[propertyName as string] = serialized;
      }
    });

  return result;
}

export function serializeEntityCollection<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  instances: readonly TEntity[],
): SerializedEntity[] {
  return instances.map(instance =>
    serializeEntity(entityConstructor, instance),
  );
}
