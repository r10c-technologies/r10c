import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  Entity,
  EntityConstructor,
  extractMetaEntity,
  readEntityEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

export const buildEntityRestAdapterGet =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions,
  ) =>
  <TEntity extends Entity>(entityId: string) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);

      const entityUrl = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.key ?? metaEntity.name,
        entityId,
      );

      const response = yield* performHttpRequestThroughFetch(
        adapterMixins.buildEntityRequest({ method: 'GET', url: entityUrl }),
      );
      const entity = yield* readEntityEnvelope(
        entityConstructor,
        response.body,
      );

      return entity as unknown as TEntity;
    });
