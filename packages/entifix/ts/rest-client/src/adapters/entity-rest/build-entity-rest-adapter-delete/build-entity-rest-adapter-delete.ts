import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { Entity, EntityConstructor, EntityId } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { BuildEntityRestOptions } from '../types';

export const buildEntityRestAdapterDelete =
  <TEntity extends Entity>(
    _entityConstructor: EntityConstructor<TEntity>,
    { uriConfig: _uriConfig }: BuildEntityRestOptions
  ) =>
  <TEntity extends Entity>(_entityOrId: EntityId | TEntity) =>
    Effect.gen(function* () {
      yield* ConfigurationRepositoryTag;

      return {} as TEntity;
    });
