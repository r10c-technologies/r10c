import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { BuildEntityRestOptions } from '../types';

export const buildEntityRestAdapterSave =
  <TEntity extends Entity>(
    _entityConstructor: EntityConstructor<TEntity>,
    { uriConfig: _uriConfig }: BuildEntityRestOptions
  ) =>
  <TEntity extends Entity>(_entity: TEntity) =>
    Effect.gen(function* () {
      yield* ConfigurationRepositoryTag;

      return {} as TEntity;
    });
