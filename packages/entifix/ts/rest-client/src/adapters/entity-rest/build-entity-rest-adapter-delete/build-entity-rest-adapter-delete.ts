import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  EntifixLogicError,
  Entity,
  EntityConstructor,
  EntityId,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

/** Accepts either an id or a whole entity, mirroring the repository contract. */
function toEntityId(entityOrId: EntityId | Entity): EntityId {
  return entityOrId != null && typeof entityOrId === 'object'
    ? (entityOrId as Entity).id
    : (entityOrId as EntityId);
}

/**
 * Deletes an entity over HTTP.
 *
 * The response body is discarded, but the service still answers with an
 * envelope rather than a bare `204`: the shared fetch client always parses the
 * response as JSON, and an empty body would fail that parse.
 */
export const buildEntityRestAdapterDelete =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions,
  ) =>
  <TEntity extends Entity>(entityOrId: EntityId | TEntity) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);
      const id = toEntityId(entityOrId);

      if (id == null) {
        return yield* Effect.fail(
          new EntifixLogicError(
            `Cannot delete a ${entityConstructor.name} without an id`,
            undefined,
            { entity: entityConstructor.name },
          ),
        );
      }

      const url = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.key ?? metaEntity.name,
        String(id),
      );

      yield* performHttpRequestThroughFetch(
        adapterMixins.buildEntityRequest({ method: 'DELETE', url }),
      );
    });
