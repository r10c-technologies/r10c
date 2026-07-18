import { extractMetaEntity } from '../entity-definition/helpers';
import {
  serializeEntity,
  serializeEntityCollection,
} from '../entity-definition/serializer';
import type { Entity, EntityConstructor } from '../types/Entity';
import type { EntityPage } from '../types/EntityPage';
import type {
  EntifixEnvelope,
  EntifixEnvelopeLink,
  EntifixEnvelopeType,
  EntityCollectionEnvelope,
  EntityEnvelope,
  EntityPageEnvelope,
} from './types';

/**
 * The transport-free envelope builder for payloads that are not serialized
 * entities — `command`/`transactionEvent` messages carry their own `data`
 * shapes (defined by the transactions layer), so they cannot go through the
 * entity builders. `entity` is still the routing label (`meta.entity`): the
 * target entity's `key` for a command, or the entity/transaction subject for an
 * event.
 */
export function makeEnvelope<TData>(
  type: EntifixEnvelopeType,
  entity: string,
  data: TData,
  links?: EntifixEnvelopeLink[],
): EntifixEnvelope<TData> {
  return {
    meta: {
      type,
      entity,
      ...(links ? { links } : {}),
    },
    data,
  };
}

/**
 * The entity name carried in `meta.entity` — the same `key ?? name` resolution
 * every adapter uses for collections and endpoints.
 */
export function envelopeEntityName<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
): string {
  const metaEntity = extractMetaEntity(entityConstructor);
  return metaEntity.key ?? metaEntity.name;
}

export function makeEntityEnvelope<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  instance: TEntity,
  links?: EntifixEnvelopeLink[],
): EntityEnvelope {
  return {
    meta: {
      type: 'entity',
      entity: envelopeEntityName(entityConstructor),
      ...(links ? { links } : {}),
    },
    data: serializeEntity(entityConstructor, instance),
  };
}

export function makeEntityCollectionEnvelope<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  instances: readonly TEntity[],
  links?: EntifixEnvelopeLink[],
): EntityCollectionEnvelope {
  return {
    meta: {
      type: 'entityCollection',
      entity: envelopeEntityName(entityConstructor),
      ...(links ? { links } : {}),
    },
    data: serializeEntityCollection(entityConstructor, instances),
  };
}

export function makeEntityPageEnvelope<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  page: EntityPage<TEntity>,
  links?: EntifixEnvelopeLink[],
): EntityPageEnvelope<TEntity> {
  return {
    meta: {
      type: 'entityPage',
      entity: envelopeEntityName(entityConstructor),
      ...(links ? { links } : {}),
    },
    data: {
      items: serializeEntityCollection(entityConstructor, page.items),
      total: page.total,
      request: page.request,
    },
  };
}
