import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  EntifixError,
  EntifixLogicError,
  Entity,
  EntityConstructor,
  EntityLinkResolver,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';
import { useMemo } from 'react';

/**
 * Maps a link target constructor to the repository adapter that loads it.
 */
export type EntityLinkRegistration = readonly [
  EntityConstructor<Entity>,
  Context.Context<EntityRepositoryTag>
];

/**
 * Assembles an {@link EntityLinkResolverTag} context from repository adapters
 * that already exist. Each registration's repository `get` is closed over the
 * configuration context, so the resulting resolver effects have no outstanding
 * requirements. Framework-agnostic — the {@link useEntityLinkResolver} hook is
 * the React-facing wrapper.
 */
export function createEntityLinkResolver(
  configurationStore: Context.Context<ConfigurationRepositoryTag>,
  registrations: ReadonlyArray<EntityLinkRegistration>
): Context.Context<EntityLinkResolverTag> {
  const repositoryByConstructor = new Map(
    registrations.map(
      ([entityConstructor, repositoryContext]) =>
        [
          entityConstructor,
          Context.get(repositoryContext, EntityRepositoryTag),
        ] as const
    )
  );

  const resolver: EntityLinkResolver = {
    resolve(entityConstructor, id) {
      const repository = repositoryByConstructor.get(
        entityConstructor as EntityConstructor<Entity>
      );
      if (!repository) {
        return Effect.fail(
          new EntifixLogicError(
            `No link resolver registered for entity "${entityConstructor.name}"`,
            undefined,
            { entity: entityConstructor.name }
          )
        );
      }
      return Effect.provide(
        repository.get(id),
        configurationStore
      ) as Effect.Effect<never, EntifixError>;
    },
  };

  return Context.make(EntityLinkResolverTag, resolver);
}

/**
 * React hook that memoizes an {@link EntityLinkResolverTag} context built from
 * the given repository adapters. This is the page-level seam for last-mile
 * wiring: a caller can register cached or state-backed adapters here without
 * touching the base adapters or the use-case.
 */
export function useEntityLinkResolver(
  configurationStore: Context.Context<ConfigurationRepositoryTag>,
  registrations: ReadonlyArray<EntityLinkRegistration>
): Context.Context<EntityLinkResolverTag> {
  // Registrations are a static list per page; key the memo on the registered
  // constructor names so it stays stable across renders without depending on the
  // array literal's identity.
  const registrationKey = registrations
    .map(([entityConstructor]) => entityConstructor.name)
    .join('|');

  return useMemo(
    () => createEntityLinkResolver(configurationStore, registrations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configurationStore, registrationKey]
  );
}
