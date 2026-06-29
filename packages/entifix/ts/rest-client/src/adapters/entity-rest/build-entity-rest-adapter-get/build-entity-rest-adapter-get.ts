import { Effect } from 'effect';
import {
  Entity,
  EntityConstructor,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { HttpRequest } from '../../../clients/types';
import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { deserializeSingleEntity } from '../../../serializer/deserialize';

import { BuildEntityRestOptions } from '../types';

export const buildEntityRestAdapterGet =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions
  ) =>
  <TEntity extends Entity>(entityId: string) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);

      const entityUrl = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.name,
        entityId
      );

      const request: HttpRequest = {
        method: 'GET',
        url: entityUrl,
      };

      const response = yield* performHttpRequestThroughFetch(request);
      const entity = yield* deserializeSingleEntity(
        entityConstructor,
        response.body
      );
      return entity as unknown as TEntity;
    });
