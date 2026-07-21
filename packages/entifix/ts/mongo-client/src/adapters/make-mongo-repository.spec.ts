import { serializeEntity } from '@r10c/entifix-ts-core';
import { runRepository, runRepositoryExit } from '@r10c/entifix-ts-testing-unit';
import {
  ContractWidget,
  describeEntityRepositoryContract,
  makeContractWidget,
} from '@r10c/entifix-ts-testing-unit/contracts';
import { makeFakeMongoDb } from '@r10c/entifix-ts-testing-unit/drivers';
import { Exit } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { makeMongoRepository } from './make-mongo-repository.js';

const COLLECTION = 'contract-widget';

/**
 * The repository runs against a fake mongodb driver rather than a fake port, so
 * the filter translation, the `_id` projection, the upsert rule and the error
 * mapping are all executed for real.
 */
const withFakeDb = (seed: ContractWidget[] = []) => {
  const fake = makeFakeMongoDb({
    [COLLECTION]: seed.map((widget) => serializeEntity(ContractWidget, widget)),
  });
  return {
    fake,
    repository: makeMongoRepository(fake.db as Db, ContractWidget),
  };
};

describeEntityRepositoryContract('mongo adapter over a fake driver', {
  makeRepository: (seed) => withFakeDb(seed).repository,
});

describe('makeMongoRepository', () => {
  it('names the collection after the entity key', async () => {
    const { fake, repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
    ]);

    await runRepository(repository.load<ContractWidget>({}));

    expect(fake.operations.every((op) => op.collection === COLLECTION)).toBe(true);
  });

  it('projects Mongo’s own _id away, so it never reaches an entity', async () => {
    const fake = makeFakeMongoDb({
      [COLLECTION]: [{ _id: 'mongo-internal', id: 'w-1', name: 'Alpha', size: 10 }],
    });
    const repository = makeMongoRepository(fake.db as Db, ContractWidget);

    const found = await runRepository(repository.get<ContractWidget>('w-1'));

    expect(found).toBeInstanceOf(ContractWidget);
    expect(found).not.toHaveProperty('_id');
  });

  it('counts the whole match, not just the page', async () => {
    const { repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({ page: 1, pageSize: 2 }),
    );

    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
  });

  it('upserts on save so a create and an update take the same path', async () => {
    const { fake, repository } = withFakeDb();

    await runRepository(repository.save<ContractWidget>(
        makeContractWidget('w-1', 'Alpha', 10),
      ));

    expect(fake.operations.map((op) => op.op)).toContain('replaceOne');
    expect(fake.read(COLLECTION)).toEqual([
      { id: 'w-1', name: 'Alpha', size: 10 },
    ]);
  });

  it('writes the minted id into the document, not only onto the entity', async () => {
    const { fake, repository } = withFakeDb();

    const saved = await runRepository(repository.save<ContractWidget>(
        makeContractWidget(undefined, 'Alpha', 10),
      ));

    // Entities are addressed by their own `id`; a document stored without one
    // would be unreachable by every later read.
    expect(fake.read(COLLECTION)[0]?.['id']).toBe(saved.id);
  });

  it('maps a driver failure onto EntifixConnError', async () => {
    const { fake, repository } = withFakeDb([
      makeContractWidget('w-1', 'Alpha', 10),
    ]);
    fake.failWith(new Error('connection refused'));

    const exit = await runRepositoryExit(repository.load<ContractWidget>({}));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
