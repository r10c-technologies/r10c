import { Effect } from 'effect';
import {
  Entity,
  EntityPage,
  EntityConstructor,
  EntityLoadRequest,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { HttpRequest } from '../../../clients/types';
import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { deserializeEntityCollection } from '../../../serializer/deserialize';

import { BuildEntityRestOptions } from '../types';

interface EntityPageResponseBody {
  items: unknown[];
  total: number;
}

export const buildEntityRestAdapterLoad =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions
  ) =>
  <TEntity extends Entity>(request: EntityLoadRequest<TEntity>) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);

      const baseUrl = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.name
      );

      const params = new URLSearchParams();
      if (request.page != null) {
        params.set('page', String(request.page));
      }
      if (request.pageSize != null) {
        params.set('pageSize', String(request.pageSize));
      }
      const query = params.toString();
      const url = query ? `${baseUrl}?${query}` : baseUrl;

      const httpRequest: HttpRequest = {
        method: 'GET',
        url,
      };

      const response =
        yield* performHttpRequestThroughFetch<EntityPageResponseBody>(
          httpRequest
        );
      const items = yield* deserializeEntityCollection(
        entityConstructor as unknown as EntityConstructor<TEntity>,
        response.body.items
      );

      return {
        items,
        total: response.body.total,
        request,
      } as unknown as EntityPage<TEntity>;
    });
