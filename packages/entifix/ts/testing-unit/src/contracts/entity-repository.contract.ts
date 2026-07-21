import type { EntityRepository } from '@r10c/entifix-ts-business';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { runRepository, runRepositoryExit } from '../effect/run';

/**
 * The entity every implementation of the contract is exercised against. It is
 * declared here rather than by each caller so the suite controls exactly which
 * fields exist.
 */
@entity({ key: 'contract-widget' })
export class ContractWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #size?: number;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number' })
  get size(): number | undefined {
    return this.#size;
  }
  set size(value: number | undefined) {
    this.#size = value;
  }
}

export const makeContractWidget = (
  id: EntityId,
  name: string,
  size: number,
): ContractWidget => {
  const widget = new ContractWidget();
  widget.id = id;
  widget.name = name;
  widget.size = size;
  return widget;
};

export interface EntityRepositoryContractOptions {
  /**
   * Builds a repository over `seed`. Called fresh for each test, so no state
   * leaks between them.
   */
  makeRepository(
    seed: ContractWidget[],
  ): EntityRepository | Promise<EntityRepository>;
}

/**
 * The behaviour every {@link EntityRepository} must exhibit, regardless of what
 * backs it.
 *
 * Run it against the in-memory fake *and* against each real adapter. That is
 * what stops a fake from drifting into a more forgiving version of the thing it
 * stands in for — the failure mode where a suite is green and production is
 * not. `entifix-ts-testing-integration` will run this same suite against real
 * infrastructure later.
 */
export const describeEntityRepositoryContract = (
  name: string,
  { makeRepository }: EntityRepositoryContractOptions,
): void => {
  describe(`EntityRepository contract: ${name}`, () => {
    const seeded = () => [
      makeContractWidget('w-1', 'Alpha', 10),
      makeContractWidget('w-2', 'Beta', 20),
      makeContractWidget('w-3', 'Gamma', 30),
    ];

    const withRepository = async (
      use: (repository: EntityRepository) => Promise<void>,
      seed: ContractWidget[] = seeded(),
    ) => {
      await use(await makeRepository(seed));
    };

    it('loads every stored entity with its total', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(repository.load<ContractWidget>({}));

        expect(page.total).toBe(3);
        expect(page.items.map((item) => item.name)).toEqual([
          'Alpha',
          'Beta',
          'Gamma',
        ]);
      });
    });

    it('echoes the request it served on the page', async () => {
      await withRepository(async (repository) => {
        const request = { page: 1, pageSize: 2 };
        const page = await runRepository(repository.load<ContractWidget>(request));

        expect(page.request).toEqual(request);
      });
    });

    it('pages with a 1-based page number', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(
          repository.load<ContractWidget>({ page: 2, pageSize: 2 }),
        );

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.name).toBe('Gamma');
        // The total counts matches, not the page.
        expect(page.total).toBe(3);
      });
    });

    it('filters by an equality operator', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(
          repository.load<ContractWidget>({
            filtering: [{ property: 'name', operator: 'eq', value: 'Beta' }],
          }),
        );

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.id).toBe('w-2');
        expect(page.total).toBe(1);
      });
    });

    it('filters by a range operator', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(
          repository.load<ContractWidget>({
            filtering: [
              { property: 'size', operator: 'between', start: 15, end: 35 },
            ],
          }),
        );

        expect(page.items.map((item) => item.id)).toEqual(['w-2', 'w-3']);
      });
    });

    it('matches `like` case-insensitively on a substring', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(
          repository.load<ContractWidget>({
            filtering: [{ property: 'name', operator: 'like', value: 'et' }],
          }),
        );

        expect(page.items.map((item) => item.id)).toEqual(['w-2']);
      });
    });

    it('sorts descending when asked to', async () => {
      await withRepository(async (repository) => {
        const page = await runRepository(
          repository.load<ContractWidget>({
            sorting: [{ 0: { property: 'size', type: 'desc' } }],
          }),
        );

        expect(page.items.map((item) => item.size)).toEqual([30, 20, 10]);
      });
    });

    it('reads a single entity by id', async () => {
      await withRepository(async (repository) => {
        const found = await runRepository(repository.get<ContractWidget>('w-2'));

        expect(found.id).toBe('w-2');
        expect(found.name).toBe('Beta');
      });
    });

    it('fails rather than resolving undefined for an unknown id', async () => {
      await withRepository(async (repository) => {
        const exit = await runRepositoryExit(
          repository.get<ContractWidget>('missing'),
        );

        expect(Exit.isFailure(exit)).toBe(true);
      });
    });

    it('mints an id when saving an entity that has none', async () => {
      await withRepository(async (repository) => {
        const created = await runRepository(
          repository.save<ContractWidget>(
            makeContractWidget(undefined, 'Delta', 40),
          ),
        );

        expect(created.id).toBeDefined();

        const page = await runRepository(repository.load<ContractWidget>({}));
        expect(page.total).toBe(4);
      });
    });

    it('overwrites in place when saving an entity that already has an id', async () => {
      await withRepository(async (repository) => {
        await runRepository(
          repository.save<ContractWidget>(
            makeContractWidget('w-2', 'Renamed', 25),
          ),
        );

        const found = await runRepository(repository.get<ContractWidget>('w-2'));
        expect(found.name).toBe('Renamed');

        const page = await runRepository(repository.load<ContractWidget>({}));
        expect(page.total).toBe(3);
      });
    });

    it('deletes by id', async () => {
      await withRepository(async (repository) => {
        await runRepository(repository.delete<ContractWidget>('w-1'));

        const page = await runRepository(repository.load<ContractWidget>({}));
        expect(page.items.map((item) => item.id)).toEqual(['w-2', 'w-3']);
      });
    });

    it('deletes by entity', async () => {
      await withRepository(async (repository) => {
        await runRepository(
          repository.delete<ContractWidget>(makeContractWidget('w-3', 'Gamma', 30)),
        );

        const page = await runRepository(repository.load<ContractWidget>({}));
        expect(page.items.map((item) => item.id)).toEqual(['w-1', 'w-2']);
      });
    });

    it('treats deleting an unknown id as a no-op', async () => {
      await withRepository(async (repository) => {
        await runRepository(repository.delete<ContractWidget>('missing'));

        const page = await runRepository(repository.load<ContractWidget>({}));
        expect(page.total).toBe(3);
      });
    });

    it('loads an empty page from an empty store', async () => {
      await withRepository(
        async (repository) => {
          const page = await runRepository(repository.load<ContractWidget>({}));

          expect(page.items).toEqual([]);
          expect(page.total).toBe(0);
        },
        [],
      );
    });
  });
};
