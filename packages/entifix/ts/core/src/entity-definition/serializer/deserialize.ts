import { Effect } from 'effect';

import { EntifixBuildError } from '../../base-entities/entifix-error';
import { Entity, EntityConstructor, EntityId } from '../../types/Entity';
import { extractMetaAccessors } from '../helpers';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';

/**
 * Result of deserializing a value against an entity constructor. A value can be
 * a single entity, a missing entity (`undefined`) or an arbitrarily nested
 * array of those — which lets collections recurse into arrays of arrays.
 */
type DeserializedEntity<TEntity extends Entity> =
  TEntity | undefined | DeserializedEntity<TEntity>[];

//#region Validations

function assertEntityObject<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityData: unknown,
): asserts entityData is object {
  if (typeof entityData !== 'object') {
    throw new EntifixBuildError(
      `Failed to deserialize entity of type ${
        entityConstructor.name
      }. Expected an object but got ${typeof entityData}`,
      undefined,
      {
        entityData,
        entityConstructor: entityConstructor.name,
      },
    );
  }
}

function assertEntityCollection<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityCollectionData: unknown,
): asserts entityCollectionData is unknown[] {
  if (!Array.isArray(entityCollectionData)) {
    throw new EntifixBuildError(
      `Failed to deserialize entity collection of type ${
        entityConstructor.name
      }. Expected an array but got ${typeof entityCollectionData}`,
      undefined,
      {
        entityCollectionData,
        entityConstructor: entityConstructor.name,
      },
    );
  }
}

//#endregion

//#region Recursive deserialization

function isEmbeddedData(value: unknown): value is object {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Populates a to-one relation from its raw value. An object is treated as
 * embedded data and deserialized into an instance; any scalar is treated as a
 * foreign key and stored as the link id (resolved lazily via `reload`).
 */
function populateEntityLink<TEntity extends Entity>(
  link: EntityLink<TEntity>,
  rawValue: unknown,
): void {
  if (rawValue == null) {
    return;
  }
  if (isEmbeddedData(rawValue)) {
    link.setValue(buildEntityInstance(link.entityConstructor, rawValue));
    return;
  }
  link.setId(rawValue as EntityId);
}

/**
 * Populates a to-many relation from its raw array, mixing embedded objects
 * (deserialized) and scalar foreign keys as they appear.
 */
function populateEntityCollectionLink<TEntity extends Entity>(
  link: EntityCollectionLink<TEntity>,
  rawValue: unknown,
): void {
  if (!Array.isArray(rawValue)) {
    return;
  }
  const values: TEntity[] = [];
  const ids: EntityId[] = [];
  for (const item of rawValue) {
    if (isEmbeddedData(item)) {
      values.push(buildEntityInstance(link.entityConstructor, item));
    } else if (item != null) {
      ids.push(item as EntityId);
    }
  }
  if (values.length > 0) {
    link.setValues(values);
  } else if (ids.length > 0) {
    link.setIds(ids);
  }
}

function buildEntityInstance<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityData: object,
): TEntity {
  const metaAccessors = extractMetaAccessors(entityConstructor);

  const newInstance = new entityConstructor();
  metaAccessors
    // Entities decorate their accessors on the getter, so the writable property
    // list comes from getter-kind metadata; read-only/hidden ones are skipped.
    // The value is then assigned through the instance's JS setter.
    .filter(
      metaAccessor =>
        !metaAccessor.hidden &&
        !metaAccessor.readonly &&
        metaAccessor.kind === 'getter',
    )
    .forEach(metaAccessor => {
      const propertyName = metaAccessor.alias ?? metaAccessor.name;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = (newInstance as any)[metaAccessor.name];

      // Relations are pre-initialized as link instances by the entity
      // constructor. Their accessors are read-only getters, so populate the
      // existing link from the raw value rather than assigning through a setter.
      if (current instanceof EntityLink) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        populateEntityLink(current, (entityData as any)[propertyName]);
        return;
      }
      if (current instanceof EntityCollectionLink) {
         
        populateEntityCollectionLink(
          current,
          (entityData as any)[propertyName],
        );
        return;
      }

      if (
        propertyName in entityData &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (entityData as any)[propertyName] !== undefined
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newInstance as any)[metaAccessor.name] = (entityData as any)[
          propertyName
        ];
      }
    });

  return newInstance;
}

function deserializeEntity<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityData: unknown,
): TEntity | undefined {
  if (entityData == null) {
    return undefined;
  }
  assertEntityObject(entityConstructor, entityData);
  return buildEntityInstance(entityConstructor, entityData);
}

function deserializeCollection<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityCollectionData: unknown,
  failOnNull: boolean,
): DeserializedEntity<TEntity>[] {
  if (entityCollectionData == null && !failOnNull) {
    return [];
  }
  assertEntityCollection(entityConstructor, entityCollectionData);

  // Recurse into nested arrays so a collection can hold arrays of arrays,
  // and reuse the single-entity validation/build for the leaf items.
  return entityCollectionData.map(item =>
    Array.isArray(item)
      ? deserializeCollection(entityConstructor, item, failOnNull)
      : deserializeEntity(entityConstructor, item),
  );
}

//#endregion

//#region Effect factories

const toEntifixBuildError =
  (message: string, context: Record<string, unknown>) => (error: unknown) =>
    error instanceof EntifixBuildError
      ? error
      : new EntifixBuildError(message, error, context);

export const deserializeSingleEntity = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityData: unknown,
) =>
  Effect.try({
    try: () => deserializeEntity(entityConstructor, entityData),
    catch: toEntifixBuildError(
      `Failed to deserialize entity of type ${entityConstructor.name}`,
      {
        entityData,
        entityConstructor: entityConstructor.name,
      },
    ),
  });

export const deserializeEntityCollection = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  entityCollectionData: unknown,
  failOnNull = false,
) =>
  Effect.try({
    try: () =>
      deserializeCollection(
        entityConstructor,
        entityCollectionData,
        failOnNull,
      ),
    catch: toEntifixBuildError(
      `Failed to deserialize entity collection of type ${entityConstructor.name}`,
      {
        entityCollectionData,
        entityConstructor: entityConstructor.name,
      },
    ),
  });

//#endregion
