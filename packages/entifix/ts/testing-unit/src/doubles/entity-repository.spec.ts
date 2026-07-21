import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ContractWidget,
  describeEntityRepositoryContract,
  makeContractWidget,
} from '../contracts/entity-repository.contract';
import { runRepository, runRepositoryExit } from '../effect/run';
import { makeInMemoryEntityRepository } from './entity-repository';

describeEntityRepositoryContract('in-memory fake', {
  makeRepository: (seed) => makeInMemoryEntityRepository(seed),
});

describe('makeInMemoryEntityRepository', () => {
  const seeded = () => [
    makeContractWidget('w-1', 'Alpha', 10),
    makeContractWidget('w-2', 'Beta', 20),
  ];

  it('exposes what it holds, so specs can assert on state rather than calls', () => {
    const repository = makeInMemoryEntityRepository(seeded());

    expect(repository.items.map((item) => item.id)).toEqual(['w-1', 'w-2']);
  });

  it('replaces its contents on seed', () => {
    const repository = makeInMemoryEntityRepository(seeded());

    repository.seed([makeContractWidget('w-9', 'Only', 90)]);

    expect(repository.items.map((item) => item.id)).toEqual(['w-9']);
  });

  it('arms a single failure so error branches are reachable', async () => {
    const repository = makeInMemoryEntityRepository(seeded());
    const failure = new EntifixConnError('backend down');
    repository.failNext(failure);

    const exit = await runRepositoryExit(repository.load<ContractWidget>({}));

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('recovers after the armed failure is consumed', async () => {
    const repository = makeInMemoryEntityRepository(seeded());
    repository.failNext(new EntifixConnError('transient'));

    await runRepositoryExit(repository.load<ContractWidget>({}));
    const page = await runRepository(repository.load<ContractWidget>({}));

    expect(page.total).toBe(2);
  });

  it('combines every top-level filtering entry with and', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Alpha', 20),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({
        filtering: [
          { property: 'name', operator: 'eq', value: 'Alpha' },
          { property: 'size', operator: 'gt', value: 15 },
        ],
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-2']);
  });

  it('applies a nested or group', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({
        filtering: [
          {
            operator: 'or',
            values: [
              { property: 'name', operator: 'eq', value: 'Alpha' },
              { property: 'name', operator: 'eq', value: 'Gamma' },
            ],
          },
        ],
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-1', 'w-3']);
  });

  it('sorts missing values below present ones', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', undefined as unknown as number),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({
        sorting: [{ 0: { property: 'size', type: 'asc' } }],
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-2', 'w-1']);
  });
});
