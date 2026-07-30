import type { SqlClient, Statement } from '@effect/sql';
import {
  accessor,
  EntifixBuildError,
  type Entity,
  entity,
  type EntityFiltering,
  type EntityId,
  type EntitySorting,
} from '@r10c/entifix-ts-core';
import { makeFakeSqlClient } from '@r10c/entifix-ts-testing-unit/drivers';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  escapeLikePattern,
  translateFiltering,
  translateSorting,
} from './sql-filter-translator.js';

/**
 * `name` carries an `alias`, which is what proves the translator emits the
 * **column** rather than the accessor name — the entity's own metadata is the
 * only column mapping this adapter has.
 */
@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #size?: number;
  #active?: boolean;
  #secret?: string;

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

  @accessor({ type: 'boolean' })
  get active(): boolean | undefined {
    return this.#active;
  }
  set active(value: boolean | undefined) {
    this.#active = value;
  }

  /** Declared unqueryable, so the allowlist has something to reject. */
  @accessor({ type: 'string', filterable: false, sortable: false })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }
}

let sql: SqlClient.SqlClient;

beforeEach(() => {
  sql = makeFakeSqlClient().client as SqlClient.SqlClient;
});

/** Compiles a fragment to the `[sql, params]` a driver would receive. */
const compile = (fragment: Statement.Fragment | undefined) =>
  fragment === undefined ? undefined : sql`${fragment}`.compile();

const where = (filtering: EntityFiltering<Widget>[]) =>
  compile(translateFiltering(sql, Widget, filtering));

describe('escapeLikePattern', () => {
  it('escapes both wildcards and the escape character itself', () => {
    expect(escapeLikePattern('100%_a\\b')).toBe('100\\%\\_a\\\\b');
  });

  it('leaves an ordinary value untouched', () => {
    expect(escapeLikePattern('plain')).toBe('plain');
  });
});

describe('translateFiltering', () => {
  it('returns undefined for absent or empty filtering', () => {
    expect(translateFiltering(sql, Widget)).toBeUndefined();
    expect(translateFiltering(sql, Widget, [])).toBeUndefined();
  });

  it.each([
    ['eq', '='],
    ['ne', '<>'],
    ['gt', '>'],
    ['gte', '>='],
    ['lt', '<'],
    ['lte', '<='],
  ] as const)('translates the binary operator %s', (operator, symbol) => {
    expect(
      where([{ property: 'size', operator, value: 10 }]),
    ).toEqual([`"size" ${symbol} $1`, [10]]);
  });

  it('emits the aliased column, not the accessor name', () => {
    expect(where([{ property: 'name', operator: 'eq', value: 'Alpha' }])).toEqual(
      ['"widget_name" = $1', ['Alpha']],
    );
  });

  it('accepts the wire key as well as the accessor name', () => {
    expect(
      where([
        { property: 'widget_name' as keyof Widget, operator: 'eq', value: 'A' },
      ]),
    ).toEqual(['"widget_name" = $1', ['A']]);
  });

  it('parameterizes every value of in / nin', () => {
    expect(where([{ property: 'size', operator: 'in', values: [1, 2] }])).toEqual(
      ['"size" IN ($1,$2)', [1, 2]],
    );
    expect(
      where([{ property: 'size', operator: 'nin', values: [3] }]),
    ).toEqual(['"size" NOT IN ($1)', [3]]);
  });

  it('translates between / nbetween', () => {
    expect(
      where([{ property: 'size', operator: 'between', start: 1, end: 9 }]),
    ).toEqual(['"size" BETWEEN $1 AND $2', [1, 9]]);
    expect(
      where([{ property: 'size', operator: 'nbetween', start: 1, end: 9 }]),
    ).toEqual(['"size" NOT BETWEEN $1 AND $2', [1, 9]]);
  });

  it('translates like / nlike to a case-insensitive contains match', () => {
    expect(where([{ property: 'name', operator: 'like', value: 'et' }])).toEqual(
      ['"widget_name" ILIKE $1', ['%et%']],
    );
    expect(
      where([{ property: 'name', operator: 'nlike', value: 'et' }]),
    ).toEqual(['"widget_name" NOT ILIKE $1', ['%et%']]);
  });

  it('escapes wildcards in a like value so it matches literally', () => {
    expect(where([{ property: 'name', operator: 'like', value: '50%' }])).toEqual(
      ['"widget_name" ILIKE $1', ['%50\\%%']],
    );
  });

  it('translates the null operators without a parameter', () => {
    expect(where([{ property: 'name', operator: 'isNull' }])).toEqual([
      '"widget_name" IS NULL',
      [],
    ]);
    expect(where([{ property: 'name', operator: 'isNotNull' }])).toEqual([
      '"widget_name" IS NOT NULL',
      [],
    ]);
  });

  it('combines a group with AND or OR', () => {
    expect(
      where([
        {
          operator: 'and',
          values: [
            { property: 'size', operator: 'gt', value: 1 },
            { property: 'active', operator: 'eq', value: true },
          ],
        },
      ]),
    ).toEqual(['("size" > $1 AND "active" = $2)', [1, true]]);

    expect(
      where([
        {
          operator: 'or',
          values: [
            { property: 'size', operator: 'gt', value: 1 },
            { property: 'size', operator: 'lt', value: 0 },
          ],
        },
      ]),
    ).toEqual(['("size" > $1 OR "size" < $2)', [1, 0]]);
  });

  it('nests groups', () => {
    expect(
      where([
        {
          operator: 'and',
          values: [
            { property: 'active', operator: 'eq', value: true },
            {
              operator: 'or',
              values: [
                { property: 'size', operator: 'eq', value: 1 },
                { property: 'size', operator: 'eq', value: 2 },
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      '("active" = $1 AND ("size" = $2 OR "size" = $3))',
      [true, 1, 2],
    ]);
  });

  it('drops an empty group rather than emitting invalid SQL', () => {
    // `AND ()` is a syntax error, so a group with nothing in it has to vanish
    // — including when it is the only entry, which must yield no WHERE at all.
    expect(translateFiltering(sql, Widget, [{ operator: 'and', values: [] }])).toBeUndefined();

    expect(
      where([
        { property: 'size', operator: 'eq', value: 1 },
        { operator: 'or', values: [] },
      ]),
    ).toEqual(['"size" = $1', [1]]);
  });

  it('flattens an array entry into its filters', () => {
    expect(
      where([
        [
          { property: 'size', operator: 'gt', value: 1 },
          { property: 'size', operator: 'lt', value: 9 },
        ],
      ]),
    ).toEqual(['("size" > $1 AND "size" < $2)', [1, 9]]);
  });

  it('AND-combines multiple top-level entries', () => {
    expect(
      where([
        { property: 'size', operator: 'gte', value: 10 },
        { property: 'name', operator: 'like', value: 'x' },
      ]),
    ).toEqual(['("size" >= $1 AND "widget_name" ILIKE $2)', [10, '%x%']]);
  });

  it('rejects a member the entity did not declare filterable', () => {
    expect(() =>
      translateFiltering(sql, Widget, [
        { property: 'secret', operator: 'eq', value: 'x' },
      ]),
    ).toThrow(EntifixBuildError);
  });

  it('rejects a member that does not exist at all', () => {
    expect(() =>
      translateFiltering(sql, Widget, [
        { property: 'nope' as keyof Widget, operator: 'eq', value: 'x' },
      ]),
    ).toThrow(/not a filterable member/);
  });

  // The `default` arm is an exhaustiveness guard: adding an operator to the
  // vocabulary without a translation here is a compile error. Reaching it at
  // runtime takes a cast, and what matters is that it does not silently degrade
  // to a match-all.
  it('does not degrade to match-all for an operator it does not know', () => {
    const unknownOperator = {
      property: 'size',
      operator: 'unknown',
    } as unknown as EntityFiltering<Widget>;

    expect(
      translateFiltering(sql, Widget, [unknownOperator]),
    ).not.toBeUndefined();
  });
});

describe('translateSorting', () => {
  const orderBy = (sorting?: EntitySorting<Widget>[]) =>
    compile(translateSorting(sql, Widget, sorting));

  it('returns undefined for absent or empty sorting', () => {
    expect(translateSorting(sql, Widget)).toBeUndefined();
    expect(translateSorting(sql, Widget, [])).toBeUndefined();
  });

  it('orders by ascending numeric priority, not declaration order', () => {
    expect(
      orderBy([
        { 1: { property: 'name', type: 'asc' }, 0: { property: 'size', type: 'desc' } },
      ]),
    ).toEqual(['"size" DESC, "widget_name" ASC', []]);
  });

  it('merges several sorting records in order', () => {
    expect(
      orderBy([
        { 0: { property: 'size', type: 'desc' } },
        { 0: { property: 'name', type: 'asc' } },
      ]),
    ).toEqual(['"size" DESC, "widget_name" ASC', []]);
  });

  it('keeps a repeated column in its first position with its last direction', () => {
    expect(
      orderBy([
        { 0: { property: 'size', type: 'asc' } },
        { 0: { property: 'name', type: 'asc' } },
        { 0: { property: 'size', type: 'desc' } },
      ]),
    ).toEqual(['"size" DESC, "widget_name" ASC', []]);
  });

  it('skips a priority slot that carries nothing', () => {
    const sorting = [
      { 0: undefined, 1: { property: 'name', type: 'asc' } },
    ] as unknown as EntitySorting<Widget>[];

    expect(orderBy(sorting)).toEqual(['"widget_name" ASC', []]);
  });

  it('returns undefined when every slot was empty', () => {
    const sorting = [{ 0: undefined }] as unknown as EntitySorting<Widget>[];

    expect(translateSorting(sql, Widget, sorting)).toBeUndefined();
  });

  it('rejects a member the entity did not declare sortable', () => {
    expect(() =>
      translateSorting(sql, Widget, [
        { 0: { property: 'secret', type: 'asc' } },
      ]),
    ).toThrow(/not a sortable member/);
  });
});
