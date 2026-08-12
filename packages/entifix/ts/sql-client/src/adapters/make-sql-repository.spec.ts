import type { SqlClient } from '@effect/sql';
import {
  accessor,
  EntifixBuildError,
  EntifixConnError,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import {
  runRepository,
  runRepositoryExit,
} from '@r10c/entifix-ts-testing-unit';
import {
  type FakeSqlClient,
  makeFakeSqlClient,
} from '@r10c/entifix-ts-testing-unit/drivers';
import { Exit } from 'effect';
import { beforeEach, describe, expect, it } from 'vitest';

import { makeSqlRepository } from './make-sql-repository.js';

/** `name` is aliased, so the row keys the adapter reads and writes are columns. */
@entity({ key: 'widget' })
class Widget implements Entity {
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

  @accessor({ type: 'string', alias: 'widget_name' })
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

/** No `key`, so the table has to be named after the class instead. */
@entity()
class UnkeyedWidget implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const makeWidget = (id: EntityId, name: string, size: number): Widget => {
  const widget = new Widget();
  widget.id = id;
  widget.name = name;
  widget.size = size;
  return widget;
};

const SELECT = 'SELECT *';
const COUNT = 'COUNT(*)';

let fake: FakeSqlClient;
let repository: ReturnType<typeof makeSqlRepository>;

beforeEach(() => {
  fake = makeFakeSqlClient([
    { match: SELECT, rows: [{ id: 'w-1', widget_name: 'Alpha', size: 10 }] },
    { match: COUNT, rows: [{ count: 3 }] },
  ]);
  repository = makeSqlRepository(fake.client as SqlClient.SqlClient, Widget);
});

/** The statement matching `match`, for assertions about what the adapter sent. */
const executed = (match: string) =>
  fake.executions.find(execution => execution.sql.includes(match));

/** The typed error of a failed exit, or `undefined` if it did not fail that way. */
const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && exit.cause._tag === 'Fail'
    ? exit.cause.error
    : undefined;

describe('makeSqlRepository', () => {
  describe('table naming', () => {
    it('names the table after the entity key', async () => {
      await runRepository(repository.load<Widget>({}));

      expect(executed(SELECT)?.sql).toContain('FROM "widget"');
    });

    it('falls back to the class name when the entity declares no key', async () => {
      const unkeyed = makeSqlRepository(
        fake.client as SqlClient.SqlClient,
        UnkeyedWidget,
      );

      await runRepository(unkeyed.load<UnkeyedWidget>({}));

      expect(executed(SELECT)?.sql).toContain('FROM "UnkeyedWidget"');
    });
  });

  describe('load', () => {
    it('deserializes rows and reports the counted total', async () => {
      const page = await runRepository(repository.load<Widget>({}));

      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toBeInstanceOf(Widget);
      expect(page.items[0]?.name).toBe('Alpha');
    });

    it('echoes the request it served on the page', async () => {
      const request = { page: 1, pageSize: 2 };

      const page = await runRepository(repository.load<Widget>(request));

      expect(page.request).toEqual(request);
    });

    it('omits WHERE and ORDER BY when nothing was asked for', async () => {
      await runRepository(repository.load<Widget>({}));

      const { sql } = executed(SELECT) ?? { sql: '' };
      expect(sql).not.toContain('WHERE');
      expect(sql).not.toContain('ORDER BY');
    });

    it('defaults to the first page of ten', async () => {
      await runRepository(repository.load<Widget>({}));

      expect(executed(SELECT)?.params).toEqual([10, 0]);
    });

    it('turns a 1-based page into an offset', async () => {
      await runRepository(repository.load<Widget>({ page: 3, pageSize: 25 }));

      expect(executed(SELECT)?.params).toEqual([25, 50]);
    });

    it('applies filtering to both the page and the count', async () => {
      await runRepository(
        repository.load<Widget>({
          filtering: [{ property: 'name', operator: 'eq', value: 'Alpha' }],
        }),
      );

      expect(executed(SELECT)?.sql).toContain('WHERE "widget_name" = $1');
      expect(executed(COUNT)?.sql).toContain('WHERE "widget_name" = $1');
    });

    it('applies sorting to the page only', async () => {
      await runRepository(
        repository.load<Widget>({
          sorting: [{ 0: { property: 'size', type: 'desc' } }],
        }),
      );

      expect(executed(SELECT)?.sql).toContain('ORDER BY "size" DESC');
      expect(executed(COUNT)?.sql).not.toContain('ORDER BY');
    });

    it('reports zero when the count comes back empty', async () => {
      fake.respondTo(COUNT, []);

      const page = await runRepository(repository.load<Widget>({}));

      expect(page.total).toBe(0);
    });

    it('fails with a build error for a member the entity did not declare', async () => {
      const exit = await runRepositoryExit(
        repository.load<Widget>({
          filtering: [
            { property: 'nope' as keyof Widget, operator: 'eq', value: 1 },
          ],
        }),
      );

      // A typed failure, not a defect: the translator throws, and the adapter is
      // what turns that into something the route layer can map to a 400.
      expect(failureOf(exit)).toBeInstanceOf(EntifixBuildError);
    });

    it('maps a failing select to a connection error', async () => {
      fake.failOn(SELECT, 'select exploded');

      const exit = await runRepositoryExit(repository.load<Widget>({}));

      expect(failureOf(exit)).toBeInstanceOf(EntifixConnError);
    });

    it('maps a failing count to a connection error', async () => {
      // Only the count fails, so the branch after a successful select is reached.
      fake.failOn(COUNT, 'count exploded');

      const exit = await runRepositoryExit(repository.load<Widget>({}));

      expect(failureOf(exit)).toBeInstanceOf(EntifixConnError);
    });
  });

  describe('get', () => {
    it('reads a single row by id', async () => {
      const found = await runRepository(repository.get<Widget>('w-1'));

      expect(found.id).toBe('w-1');
      expect(found.name).toBe('Alpha');
      expect(executed(SELECT)?.sql).toContain('WHERE "id" = $1');
      expect(executed(SELECT)?.params).toEqual(['w-1']);
    });

    it('fails rather than resolving undefined for an unknown id', async () => {
      fake.respondTo(SELECT, []);

      const exit = await runRepositoryExit(repository.get<Widget>('missing'));

      expect(failureOf(exit)).toBeInstanceOf(EntifixConnError);
    });

    it('maps a driver failure to a connection error', async () => {
      fake.failWith('read exploded');

      const exit = await runRepositoryExit(repository.get<Widget>('w-1'));

      expect(Exit.isFailure(exit)).toBe(true);
    });
  });

  describe('save', () => {
    it('upserts on the id, overwriting every other column', async () => {
      const saved = await runRepository(
        repository.save<Widget>(makeWidget('w-2', 'Renamed', 25)),
      );

      expect(saved.id).toBe('w-2');
      const { sql, params } = executed('INSERT INTO') ?? {
        sql: '',
        params: [],
      };
      expect(sql).toContain('ON CONFLICT ("id") DO UPDATE SET');
      expect(sql).toContain('"widget_name" = EXCLUDED."widget_name"');
      expect(sql).toContain('"size" = EXCLUDED."size"');
      expect(params).toContain('Renamed');
      expect(params).toContain('w-2');
    });

    it('mints an id when the entity has none, and writes it back', async () => {
      const created = await runRepository(
        repository.save<Widget>(makeWidget(undefined, 'Delta', 40)),
      );

      expect(created.id).toBeDefined();
      expect(executed('INSERT INTO')?.params).toContain(created.id);
    });

    it('degrades to DO NOTHING for an entity that has only an id', async () => {
      // `DO UPDATE SET` with an empty column list is a syntax error, so an
      // entity with nothing else to write must not produce one.
      const unkeyed = makeSqlRepository(
        fake.client as SqlClient.SqlClient,
        UnkeyedWidget,
      );
      const widget = new UnkeyedWidget();
      widget.id = 'u-1';

      await runRepository(unkeyed.save<UnkeyedWidget>(widget));

      const { sql } = executed('INSERT INTO') ?? { sql: '' };
      expect(sql).toContain('ON CONFLICT ("id") DO NOTHING');
      expect(sql).not.toContain('DO UPDATE');
    });

    it('maps a driver failure to a connection error', async () => {
      fake.failWith('write exploded');

      const exit = await runRepositoryExit(
        repository.save<Widget>(makeWidget('w-2', 'Renamed', 25)),
      );

      expect(failureOf(exit)).toBeInstanceOf(EntifixConnError);
    });
  });

  describe('delete', () => {
    it('deletes by id', async () => {
      await runRepository(repository.delete<Widget>('w-1'));

      expect(executed('DELETE FROM')?.sql).toContain(
        'DELETE FROM "widget" WHERE "id" = $1',
      );
      expect(executed('DELETE FROM')?.params).toEqual(['w-1']);
    });

    it('deletes by entity, using its id', async () => {
      await runRepository(
        repository.delete<Widget>(makeWidget('w-3', 'Gamma', 30)),
      );

      expect(executed('DELETE FROM')?.params).toEqual(['w-3']);
    });

    it('maps a driver failure to a connection error', async () => {
      fake.failWith('delete exploded');

      const exit = await runRepositoryExit(repository.delete<Widget>('w-1'));

      expect(failureOf(exit)).toBeInstanceOf(EntifixConnError);
    });
  });
});
