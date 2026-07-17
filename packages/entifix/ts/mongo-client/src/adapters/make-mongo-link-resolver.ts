import { EntityLinkResolverTag } from '@r10c/entifix-ts-business';
import {
  EntifixError,
  EntifixLogicError,
  Entity,
  EntityConstructor,
  EntityLinkResolver,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import type { Db } from 'mongodb';

import { makeMongoRepository } from './make-mongo-repository';

/**
 * Builds an {@link EntityLinkResolverTag} context backed by Mongo repositories,
 * so a load use-case can materialize not-yet-loaded {@link EntityLink}s on the
 * backend. Mirrors the REST `createEntityLinkResolver`, but each Mongo `get`
 * already has no outstanding requirements, so nothing needs to be provided.
 *
 * `registrations` lists the link-target constructors this resolver can fetch.
 */
export function makeMongoLinkResolver(
  db: Db,
  registrations: ReadonlyArray<EntityConstructor<Entity>>,
): Context.Context<EntityLinkResolverTag> {
  const repositoryByConstructor = new Map(
    registrations.map(
      entityConstructor =>
        [entityConstructor, makeMongoRepository(db, entityConstructor)] as const,
    ),
  );

  const resolver: EntityLinkResolver = {
    resolve(entityConstructor, id) {
      const repository = repositoryByConstructor.get(
        entityConstructor as EntityConstructor<Entity>,
      );
      if (!repository) {
        return Effect.fail(
          new EntifixLogicError(
            `No Mongo link resolver registered for entity "${entityConstructor.name}"`,
            undefined,
            { entity: entityConstructor.name },
          ),
        );
      }
      return repository.get(id) as unknown as Effect.Effect<never, EntifixError>;
    },
  };

  return Context.make(EntityLinkResolverTag, resolver);
}
