import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  Entity,
  EntityConstructor,
  extractMetaEntity,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

/**
 * Persists an entity over HTTP.
 *
 * An entity without an id has never been stored, so it is created with `POST`
 * against the collection; one with an id is replaced with `PUT` against its own
 * URL. Either way the response envelope — not the request — is what gets
 * deserialized and returned, because the service is the authority on the stored
 * entity (it assigns ids and may normalize fields).
 */
export const buildEntityRestAdapterSave =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions,
  ) =>
  // Deliberately not shadowing `TEntity` here (as the read builders do): the
  // envelope has to be built against the *constructor's* entity type, which a
  // shadowed parameter would make unreachable.
  <TInput extends Entity>(entity: TInput) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);
      const isCreate = entity.id == null;

      const url = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.key ?? metaEntity.name,
        isCreate ? undefined : String(entity.id),
      );

      const httpRequest = adapterMixins.buildEntityRequest({
        method: isCreate ? 'POST' : 'PUT',
        url,
        envelope: makeEntityEnvelope(
          entityConstructor,
          entity as unknown as TEntity,
        ),
      });

      const response = yield* performHttpRequestThroughFetch(httpRequest);
      const saved = yield* readEntityEnvelope(
        entityConstructor,
        response.body,
      );

      return saved as unknown as TInput;
    });
