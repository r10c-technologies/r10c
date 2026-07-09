import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  Entity,
  EntityConstructor,
  EntityLoadRequest,
  EntityPage,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { HttpRequest } from '../../../clients/types';
import { deserializeEntityCollection } from '../../../serializer/deserialize';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

interface EntityPageResponseBody {
  items: unknown[];
  total: number;
}

export const buildEntityRestAdapterLoad =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions,
  ) =>
  <TEntity extends Entity>(request: EntityLoadRequest<TEntity>) =>
    Effect.gen(function* () {
      const configurationStore = yield* ConfigurationRepositoryTag;
      const metaEntity = extractMetaEntity(entityConstructor);

      const baseUrl = yield* adapterMixins.buildEntityBaseUrl(
        configurationStore,
        { uriConfig },
        metaEntity.key ?? metaEntity.name,
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
          httpRequest,
        );
      const items = yield* deserializeEntityCollection(
        entityConstructor as unknown as EntityConstructor<TEntity>,
        response.body.items,
      );

      return {
        items,
        total: response.body.total,
        request,
      } as unknown as EntityPage<TEntity>;
    });
