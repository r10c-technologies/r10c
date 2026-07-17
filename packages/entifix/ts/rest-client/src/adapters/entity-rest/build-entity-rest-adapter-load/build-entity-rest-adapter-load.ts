import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  Entity,
  EntityConstructor,
  EntityLoadRequest,
  EntityPage,
  extractMetaEntity,
  readEntityPageEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { performHttpRequestThroughFetch } from '../../../clients/fetch';
import { buildEntityRestAdapterMixins as adapterMixins } from '../build-entity-rest-adapter-mixins';
import { BuildEntityRestOptions } from '../types';

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

      const response = yield* performHttpRequestThroughFetch(
        adapterMixins.buildEntityRequest({ method: 'GET', url }),
      );
      const page = yield* readEntityPageEnvelope(
        entityConstructor,
        response.body,
      );

      // The envelope echoes the request the service actually served; prefer the
      // one this call made, which carries the caller's filtering/sorting types.
      return {
        ...page,
        request,
      } as unknown as EntityPage<TEntity>;
    });
