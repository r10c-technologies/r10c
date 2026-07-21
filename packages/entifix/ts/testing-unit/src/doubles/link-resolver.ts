import {
  EntifixConnError,
  type Entity,
  type EntityConstructor,
  type EntityId,
  type EntityLinkResolver,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

export interface InMemoryEntityLinkResolver extends EntityLinkResolver {
  /** Every (constructor, id) pair the resolver was asked for, in order. */
  readonly requested: ReadonlyArray<{ entity: string; id: EntityId }>;
}

/**
 * In-memory {@link EntityLinkResolver} over a per-constructor table of targets.
 *
 * A use-case that follows links yields `EntityLinkResolverTag`, so this is the
 * double that lets link-following be tested without any adapter at all — and
 * `requested` shows whether an already-embedded link was needlessly refetched.
 */
export const makeInMemoryEntityLinkResolver = (
  entries: ReadonlyArray<readonly [EntityConstructor<never>, Entity[]]>,
): InMemoryEntityLinkResolver => {
  const tables = new Map<unknown, Entity[]>(
    entries.map(([constructor, items]) => [constructor, items]),
  );
  const requested: Array<{ entity: string; id: EntityId }> = [];

  return {
    resolve: <TEntity extends Entity>(
      entityConstructor: EntityConstructor<TEntity>,
      id: EntityId,
    ) =>
      Effect.suspend(() => {
        requested.push({ entity: entityConstructor.name, id });
        const found = tables.get(entityConstructor)?.find((item) => item.id === id);
        return found === undefined
          ? Effect.fail(
              new EntifixConnError('Link target not found', undefined, {
                entity: entityConstructor.name,
                id,
              }),
            )
          : Effect.succeed(found as TEntity);
      }),
    get requested() {
      return requested;
    },
  };
};
