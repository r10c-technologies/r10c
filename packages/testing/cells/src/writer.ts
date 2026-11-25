import { EntityRepositoryTag } from '@entifix/business';
import { type Entity, type EntityWriter, settled } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { Context, Effect } from 'effect';

/**
 * A writer that settles every write through a spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
export const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/**
 * One entity's read and write halves over one in-memory repository — what a
 * shell's adapter set names `<entity>Rest` and `<entity>Writer`. A spec
 * spreads the real adapter set and replaces only these pairs, so an adapter it
 * never touches costs it nothing (#773).
 *
 * Pass the repository when the spec also reads it directly; pass the entities
 * when it only renders them.
 */
export const inMemoryEntity = (
  seed:
    | readonly Entity[]
    | ReturnType<typeof makeInMemoryEntityRepository> = [],
) => {
  const rest = Context.make(
    EntityRepositoryTag,
    Array.isArray(seed)
      ? makeInMemoryEntityRepository([...(seed as readonly Entity[])])
      : (seed as ReturnType<typeof makeInMemoryEntityRepository>),
  );
  return { rest, writer: settledWriter(rest) } as const;
};
