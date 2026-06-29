import { Effect } from 'effect';
import { Entity, EntityConstructor, EntityId } from '@r10c/entifix-ts-core';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { BuildEntityRestOptions } from '../types';

export const buildEntityRestAdapterDelete =
  <TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    { uriConfig }: BuildEntityRestOptions
  ) =>
  <TEntity extends Entity>(entityOrId: EntityId | TEntity) =>
    Effect.gen(function* () {
      yield* ConfigurationRepositoryTag;

      return {} as TEntity;
    });
