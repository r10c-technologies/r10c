import type { ConfigurationStore, Entity, EntityId } from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

import { ConfigurationRepositoryTag } from '../repository/config.repository.js';
import type { EntityRepository } from '../repository/entity.repository.js';
import { EntityRepositoryTag } from '../repository/entity.repository.js';
import {
  EntityIdTag,
  EntityTag,
} from '../repository/entity-mixins.repository.js';
import { deleteUCFactory } from './delete/index.js';
import { saveUCFactory } from './save/index.js';

interface Widget extends Entity {
  name: string;
}

/**
 * A hand-rolled repository double. The use-cases only ever touch the tag, so a
 * partial implementation is enough — and it keeps this spec free of decorators,
 * which this package's `.spec.swcrc` compiles in legacy mode.
 */
function makeRepositoryDouble(saveResult?: Widget) {
  const calls = {
    saved: [] as Entity[],
    deleted: [] as (EntityId | Entity)[],
  };
  const repository = {
    save: (entity: Entity) => {
      calls.saved.push(entity);
      return Effect.succeed(saveResult ?? entity);
    },
    delete: (entityOrId: EntityId | Entity) => {
      calls.deleted.push(entityOrId);
      return Effect.void;
    },
  } as unknown as EntityRepository;

  return { repository, calls };
}

/**
 * The repository contract types every method's requirement channel as
 * `ConfigurationRepositoryTag` (real adapters read their base URL from it), so
 * the use-cases inherit that requirement and it has to be discharged here too.
 * The doubles never touch it.
 */
const testContext = (repository: EntityRepository) =>
  Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(ConfigurationRepositoryTag, {} as ConfigurationStore),
  );

describe('saveUCFactory', () => {
  it('passes the entity from EntityTag to the repository', () => {
    const widget: Widget = { id: 'widget-1', name: 'Sprocket' };
    const { repository, calls } = makeRepositoryDouble();

    Effect.runSync(
      saveUCFactory<Widget>().pipe(
        Effect.provide(testContext(repository).pipe(Context.add(EntityTag, widget))),
      ),
    );

    expect(calls.saved).toEqual([widget]);
  });

  it('returns the repository result, not the input — a create learns its id', () => {
    const input: Widget = { id: undefined, name: 'Sprocket' };
    const stored: Widget = { id: 'generated-1', name: 'Sprocket' };
    const { repository } = makeRepositoryDouble(stored);

    const result = Effect.runSync(
      saveUCFactory<Widget>().pipe(
        Effect.provide(testContext(repository).pipe(Context.add(EntityTag, input))),
      ),
    );

    expect(result).toBe(stored);
    expect(result.id).toBe('generated-1');
  });
});

describe('deleteUCFactory', () => {
  it('passes the id from EntityIdTag to the repository', () => {
    const { repository, calls } = makeRepositoryDouble();

    Effect.runSync(
      deleteUCFactory<Widget>().pipe(
        Effect.provide(testContext(repository).pipe(Context.add(EntityIdTag, 'widget-1'))),
      ),
    );

    expect(calls.deleted).toEqual(['widget-1']);
  });
});
