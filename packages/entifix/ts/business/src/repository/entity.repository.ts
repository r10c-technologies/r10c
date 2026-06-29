import type {
  EntifixError,
  Entity,
  EntityId,
  EntityLoadRequest,
  EntityPage,
} from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

import { ConfigurationRepositoryTag } from './config.repository';

export interface EntityRepository {
  get<TEntity extends Entity>(
    id: EntityId
  ): Effect<TEntity, EntifixError, ConfigurationRepositoryTag>;
  load<TEntity extends Entity>(
    request: EntityLoadRequest<TEntity>
  ): Effect<EntityPage<TEntity>, EntifixError, ConfigurationRepositoryTag>;
  save<TEntity extends Entity>(
    entity: TEntity
  ): Effect<TEntity, EntifixError, ConfigurationRepositoryTag>;
  delete<TEntity extends Entity>(
    entityOrId: EntityId | TEntity
  ): Effect<void, EntifixError, ConfigurationRepositoryTag>;
}

export class EntityRepositoryTag extends Context.Tag('EntityRepositoryTag')<
  EntityRepositoryTag,
  EntityRepository
>() {}
