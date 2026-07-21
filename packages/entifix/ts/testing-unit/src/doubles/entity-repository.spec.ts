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

// The fake has to evaluate the same operator vocabulary the Mongo translator
// emits, or a filter that works against the adapter would silently match
// nothing against the fake — exactly the drift the contract suites exist to
// prevent.
describe('makeInMemoryEntityRepository filtering', () => {
  const seeded = () =>
    makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ]);

  const matching = async (filtering: unknown) => {
    const page = await runRepository(
      seeded().load<ContractWidget>({
        filtering: filtering as never,
      }),
    );
    return page.items.map((item) => item.id);
  };

  it.each([
    ['eq', [{ property: 'size', operator: 'eq', value: 20 }], ['w-2']],
    ['ne', [{ property: 'size', operator: 'ne', value: 20 }], ['w-1', 'w-3']],
    ['gt', [{ property: 'size', operator: 'gt', value: 20 }], ['w-3']],
    ['gte', [{ property: 'size', operator: 'gte', value: 20 }], ['w-2', 'w-3']],
    ['lt', [{ property: 'size', operator: 'lt', value: 20 }], ['w-1']],
    ['lte', [{ property: 'size', operator: 'lte', value: 20 }], ['w-1', 'w-2']],
    ['in', [{ property: 'id', operator: 'in', values: ['w-1', 'w-3'] }], ['w-1', 'w-3']],
    ['nin', [{ property: 'id', operator: 'nin', values: ['w-1'] }], ['w-2', 'w-3']],
    [
      'between',
      [{ property: 'size', operator: 'between', start: 15, end: 25 }],
      ['w-2'],
    ],
    [
      'nbetween',
      [{ property: 'size', operator: 'nbetween', start: 15, end: 25 }],
      ['w-1', 'w-3'],
    ],
    ['like', [{ property: 'name', operator: 'like', value: 'et' }], ['w-2']],
    ['nlike', [{ property: 'name', operator: 'nlike', value: 'et' }], ['w-1', 'w-3']],
    ['isNull', [{ property: 'name', operator: 'isNull' }], []],
    [
      'isNotNull',
      [{ property: 'name', operator: 'isNotNull' }],
      ['w-1', 'w-2', 'w-3'],
    ],
    [
      'an and-group',
      [
        {
          operator: 'and',
          values: [
            { property: 'size', operator: 'gte', value: 20 },
            { property: 'name', operator: 'eq', value: 'Beta' },
          ],
        },
      ],
      ['w-2'],
    ],
    [
      'an or-group',
      [
        {
          operator: 'or',
          values: [
            { property: 'name', operator: 'eq', value: 'Alpha' },
            { property: 'name', operator: 'eq', value: 'Gamma' },
          ],
        },
      ],
      ['w-1', 'w-3'],
    ],
    [
      'a nested array of filters',
      [
        [
          { property: 'size', operator: 'gte', value: 20 },
          { property: 'name', operator: 'eq', value: 'Beta' },
        ],
      ],
      ['w-2'],
    ],
  ])('evaluates %s', async (_label, filtering, expected) => {
    expect(await matching(filtering)).toEqual(expected);
  });

  it('matches everything with no filtering at all', async () => {
    expect(await matching(undefined)).toEqual(['w-1', 'w-2', 'w-3']);
  });

  it('matches a case-insensitive substring', async () => {
    expect(
      await matching([{ property: 'name', operator: 'like', value: 'ET' }]),
    ).toEqual(['w-2']);
  });

  // `like` is a substring match, not a pattern — a regex metacharacter in the
  // search text must match itself.
  it('escapes regex metacharacters in a like value', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'a.b', 10),
      makeContractWidget('w-2', 'axb', 20),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({
        filtering: [{ property: 'name', operator: 'like', value: 'a.b' }] as never,
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-1']);
  });
});

describe('makeInMemoryEntityRepository sorting', () => {
  const seeded = () =>
    makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Alpha', 30),
      makeContractWidget('w-2', 'Beta', 10),
      makeContractWidget('w-3', 'Gamma', 20),
    ]);

  const ordered = async (sorting: unknown) => {
    const page = await runRepository(
      seeded().load<ContractWidget>({ sorting: sorting as never }),
    );
    return page.items.map((item) => item.id);
  };

  it.each([
    ['ascending', [{ 0: { property: 'size', type: 'asc' } }], ['w-2', 'w-3', 'w-1']],
    ['descending', [{ 0: { property: 'size', type: 'desc' } }], ['w-1', 'w-3', 'w-2']],
    ['a string member', [{ 0: { property: 'name', type: 'asc' } }], ['w-1', 'w-2', 'w-3']],
  ])('sorts %s', async (_label, sorting, expected) => {
    expect(await ordered(sorting)).toEqual(expected);
  });

  it('keeps the seeded order with no sorting', async () => {
    expect(await ordered(undefined)).toEqual(['w-1', 'w-2', 'w-3']);
  });

  it('breaks ties by the next sort in precedence', async () => {
    const repository = makeInMemoryEntityRepository([
      makeContractWidget('w-1', 'Beta', 10),
      makeContractWidget('w-2', 'Alpha', 10),
    ]);

    const page = await runRepository(
      repository.load<ContractWidget>({
        sorting: [
          {
            0: { property: 'size', type: 'asc' },
            1: { property: 'name', type: 'asc' },
          },
        ] as never,
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-2', 'w-1']);
  });
});

// Comparison has to agree with Mongo's: absent values sort first, dates sort
// chronologically, and everything else lexicographically.
describe('makeInMemoryEntityRepository value comparison', () => {
  const widgetWith = (id: string, size: unknown) => {
    const widget = makeContractWidget(id, 'Name', 0);
    (widget as unknown as Record<string, unknown>)['size'] = size;
    return widget;
  };

  const ordered = async (items: ContractWidget[]) => {
    const page = await runRepository(
      makeInMemoryEntityRepository(items).load<ContractWidget>({
        sorting: [{ 0: { property: 'size', type: 'asc' } }] as never,
      }),
    );
    return page.items.map((item) => item.id);
  };

  it('sorts an absent value first', async () => {
    expect(
      await ordered([widgetWith('w-1', 10), widgetWith('w-2', undefined)]),
    ).toEqual(['w-2', 'w-1']);
  });

  it('sorts an absent value first whichever side it arrives on', async () => {
    expect(
      await ordered([widgetWith('w-1', undefined), widgetWith('w-2', 10)]),
    ).toEqual(['w-1', 'w-2']);
  });

  it('treats two absent values as equal', async () => {
    expect(
      await ordered([widgetWith('w-1', undefined), widgetWith('w-2', undefined)]),
    ).toEqual(['w-1', 'w-2']);
  });

  it('sorts dates chronologically', async () => {
    expect(
      await ordered([
        widgetWith('w-1', new Date('2026-07-20')),
        widgetWith('w-2', new Date('2026-01-01')),
      ]),
    ).toEqual(['w-2', 'w-1']);
  });

  it('falls back to a lexicographic comparison', async () => {
    expect(
      await ordered([widgetWith('w-1', 'beta'), widgetWith('w-2', 'alpha')]),
    ).toEqual(['w-2', 'w-1']);
  });

  // The `default` arm is an exhaustiveness guard: adding an operator without a
  // case here is a compile error. Reaching it takes a cast, and it returns the
  // node itself — truthy, so an unknown operator matches rather than silently
  // filtering everything out. Pinned because that is what callers get today.
  it('reaches its exhaustiveness guard only through a cast', async () => {
    const page = await runRepository(
      makeInMemoryEntityRepository([
        makeContractWidget('w-1', 'Alpha', 10),
      ]).load<ContractWidget>({
        filtering: [{ property: 'name', operator: 'unknown' }] as never,
      }),
    );

    expect(page.items.map((item) => item.id)).toEqual(['w-1']);
  });
});
