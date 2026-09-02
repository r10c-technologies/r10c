import { Entity, EntityConstructor } from '../../types/Entity';
import { extractMetaAccessors } from '../helpers';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';
import type { ChildConstructor } from '../meta-entities/meta-accessor';

/**
 * A plain, JSON-safe representation of an entity — the inverse of
 * {@link buildEntityInstance}. Relations collapse to the shape the deserializer
 * expects to round-trip:
 * - an {@link EntityLink} → the embedded plain object when loaded, otherwise the
 *   scalar foreign-key id.
 * - an {@link EntityCollectionLink} → an array mixing embedded objects (loaded)
 *   or scalar ids.
 * - a `composition` member → an array of plain child objects, each walked with
 *   the child's own accessor metadata.
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

/**
 * Owned rows, each flattened through the child's own accessors.
 *
 * A child is a class whose private fields carry its state, so passing the array
 * through untouched would put `[{}, {}]` on the wire and in the database — the
 * rows would silently never persist. Walking each one is also what keeps a
 * child's `alias` meaning what it means everywhere else: its column name.
 *
 * It reads a plain object just as happily as an instance, which is deliberate:
 * a row that never went through the deserializer (a fixture, a hand-built
 * command payload) serializes to the same document.
 */
function serializeComposition(
  rows: readonly unknown[],
  childType: ChildConstructor,
): unknown {
  return rows.map(row =>
    serializeEntity(childType as EntityConstructor<Entity>, row as Entity),
  );
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
      } else if (
        metaAccessor.type === 'composition' &&
        metaAccessor.childType !== undefined &&
        Array.isArray(value)
      ) {
        serialized = serializeComposition(value, metaAccessor.childType());
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
