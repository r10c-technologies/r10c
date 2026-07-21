import { describe, expect, it } from 'vitest';

import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import type { EntityFiltering, FilterGroup } from '../types/EntityFiltering.js';
import type { EntitySorting } from '../types/EntitySorting.js';
import { coerceFiltering } from './coerce-rsql.js';
import {
  parseLoadRequestParams,
  serializeLoadRequestParams,
} from './load-request-url.js';
import { parseRsql } from './parse-rsql.js';
import { serializeRsql } from './serialize-rsql.js';
import { parseSort, serializeSort } from './sort-param.js';

/**
 * A stand-in for a catalog entity, carrying one member of every type the codec
 * has to coerce plus the two kinds of member a client may not name at all: a
 * `hidden` one and one that opted out of filtering.
 */
@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;
  #active = false;
  #releasedAt?: Date;
  #status?: string;
  #serial?: string;
  #secret?: string;
  #internal?: string;

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
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'boolean' })
  get active(): boolean {
    return this.#active;
  }
  set active(value: boolean) {
    this.#active = value;
  }

  @accessor({ type: 'date' })
  get releasedAt(): Date | undefined {
    return this.#releasedAt;
  }
  set releasedAt(value: Date | undefined) {
    this.#releasedAt = value;
  }

  @accessor({ type: 'enum', enumValues: ['draft', 'live'] })
  get status(): string | undefined {
    return this.#status;
  }
  set status(value: string | undefined) {
    this.#status = value;
  }

  /** Wire key differs from the accessor name — both must address the member. */
  @accessor({ type: 'string', alias: 'serial_no' })
  get serial(): string | undefined {
    return this.#serial;
  }
  set serial(value: string | undefined) {
    this.#serial = value;
  }

  @accessor({ hidden: true })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }

  @accessor({ type: 'string', filterable: false, sortable: false })
  get internal(): string | undefined {
    return this.#internal;
  }
  set internal(value: string | undefined) {
    this.#internal = value;
  }
}

const filter = (text: string) => coerceFiltering(Widget, parseRsql(text));

describe('serializeRsql', () => {
  it.each([
    ['eq', { property: 'name', operator: 'eq', value: 'Acme' }, 'name==Acme'],
    ['ne', { property: 'name', operator: 'ne', value: 'Acme' }, 'name!=Acme'],
    ['gt', { property: 'stock', operator: 'gt', value: 10 }, 'stock=gt=10'],
    ['gte', { property: 'stock', operator: 'gte', value: 10 }, 'stock=ge=10'],
    ['lt', { property: 'stock', operator: 'lt', value: 10 }, 'stock=lt=10'],
    ['lte', { property: 'stock', operator: 'lte', value: 10 }, 'stock=le=10'],
    [
      'like',
      { property: 'name', operator: 'like', value: 'cme' },
      'name=like=cme',
    ],
    [
      'nlike',
      { property: 'name', operator: 'nlike', value: 'cme' },
      'name=nlike=cme',
    ],
    [
      'in',
      { property: 'status', operator: 'in', values: ['draft', 'live'] },
      'status=in=(draft,live)',
    ],
    [
      'nin',
      { property: 'status', operator: 'nin', values: ['draft'] },
      'status=out=(draft)',
    ],
    [
      'between',
      { property: 'stock', operator: 'between', start: 1, end: 9 },
      'stock=btn=(1,9)',
    ],
    [
      'nbetween',
      { property: 'stock', operator: 'nbetween', start: 1, end: 9 },
      'stock=nbtn=(1,9)',
    ],
    ['isNull', { property: 'name', operator: 'isNull' }, 'name=isnull=true'],
    [
      'isNotNull',
      { property: 'name', operator: 'isNotNull' },
      'name=isnull=false',
    ],
  ])('writes the %s operator', (_label, node, expected) => {
    expect(serializeRsql([node as EntityFiltering<Widget>])).toBe(expected);
  });

  it('joins top-level entries with and', () => {
    expect(
      serializeRsql([
        { property: 'name', operator: 'eq', value: 'Acme' },
        { property: 'stock', operator: 'gt', value: 10 },
      ] as EntityFiltering<Widget>[]),
    ).toBe('name==Acme;stock=gt=10');
  });

  it('flattens an array entry, as the Mongo translator does', () => {
    expect(
      serializeRsql([
        [
          { property: 'name', operator: 'eq', value: 'Acme' },
          { property: 'stock', operator: 'gt', value: 10 },
        ],
      ] as EntityFiltering<Widget>[]),
    ).toBe('name==Acme;stock=gt=10');
  });

  it('writes a group with its own separator', () => {
    expect(
      serializeRsql([
        {
          operator: 'or',
          values: [
            { property: 'name', operator: 'eq', value: 'Acme' },
            { property: 'name', operator: 'eq', value: 'Globex' },
          ],
        },
      ] as EntityFiltering<Widget>[]),
    ).toBe('(name==Acme,name==Globex)');
  });

  it('parenthesizes a nested group only when the logic changes', () => {
    const nested: FilterGroup<Widget> = {
      operator: 'and',
      values: [
        { property: 'stock', operator: 'gt', value: 1 },
        {
          operator: 'or',
          values: [
            { property: 'name', operator: 'eq', value: 'Acme' },
            { property: 'name', operator: 'eq', value: 'Globex' },
          ],
        },
        {
          operator: 'and',
          values: [{ property: 'active', operator: 'eq', value: true }],
        },
      ],
    } as FilterGroup<Widget>;

    expect(serializeRsql([nested])).toBe(
      'stock=gt=1;(name==Acme,name==Globex);active==true',
    );
  });

  it.each([
    ['no filtering', undefined],
    ['an empty array', []],
    ['a group with no values', [{ operator: 'and', values: [] }]],
  ])('yields an empty expression for %s', (_label, filtering) => {
    expect(serializeRsql(filtering as EntityFiltering<Widget>[])).toBe('');
  });

  it('drops an empty nested group rather than emitting a stray separator', () => {
    expect(
      serializeRsql([
        {
          operator: 'and',
          values: [
            { property: 'name', operator: 'eq', value: 'Acme' },
            { operator: 'or', values: [] },
          ],
        },
      ] as EntityFiltering<Widget>[]),
    ).toBe('name==Acme');
  });
});

describe('value encoding', () => {
  it('writes numbers and booleans bare', () => {
    expect(
      serializeRsql([
        { property: 'stock', operator: 'eq', value: 7 },
      ] as EntityFiltering<Widget>[]),
    ).toBe('stock==7');
    expect(
      serializeRsql([
        { property: 'active', operator: 'eq', value: false },
      ] as EntityFiltering<Widget>[]),
    ).toBe('active==false');
  });

  it('writes a date as ISO-8601', () => {
    expect(
      serializeRsql([
        {
          property: 'releasedAt',
          operator: 'eq',
          value: new Date('2026-07-21T00:00:00.000Z'),
        },
      ] as EntityFiltering<Widget>[]),
    ).toBe("releasedAt=='2026-07-21T00:00:00.000Z'");
  });

  it.each([
    ['a separator', 'a;b', "name=='a;b'"],
    ['whitespace', 'a b', "name=='a b'"],
    ['a quote', "O'Neill", "name=='O\\'Neill'"],
    ['a backslash', 'a\\b', "name=='a\\\\b'"],
    ['an operator character', 'a==b', "name=='a==b'"],
    ['nothing at all', '', "name==''"],
  ])('quotes a value containing %s', (_label, value, expected) => {
    expect(
      serializeRsql([
        { property: 'name', operator: 'eq', value },
      ] as EntityFiltering<Widget>[]),
    ).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('writes %s as an empty quoted value', (_label, value) => {
    expect(
      serializeRsql([
        { property: 'name', operator: 'eq', value },
      ] as unknown as EntityFiltering<Widget>[]),
    ).toBe("name==''");
  });
});

describe('parseRsql', () => {
  it('parses a single comparison into a one-value group', () => {
    expect(parseRsql('name==Acme')).toEqual({
      operator: 'and',
      values: [{ property: 'name', operator: 'eq', value: 'Acme' }],
    });
  });

  it('binds and tighter than or, as RSQL specifies', () => {
    expect(parseRsql('a==1;b==2,c==3')).toEqual({
      operator: 'or',
      values: [
        {
          operator: 'and',
          values: [
            { property: 'a', operator: 'eq', value: '1' },
            { property: 'b', operator: 'eq', value: '2' },
          ],
        },
        { property: 'c', operator: 'eq', value: '3' },
      ],
    });
  });

  it('lets parentheses override precedence', () => {
    expect(parseRsql('(a==1,b==2);c==3')).toEqual({
      operator: 'and',
      values: [
        {
          operator: 'or',
          values: [
            { property: 'a', operator: 'eq', value: '1' },
            { property: 'b', operator: 'eq', value: '2' },
          ],
        },
        { property: 'c', operator: 'eq', value: '3' },
      ],
    });
  });

  it('reads a value list', () => {
    expect(parseRsql('status=in=(draft,live)')).toEqual({
      operator: 'and',
      values: [
        { property: 'status', operator: 'in', values: ['draft', 'live'] },
      ],
    });
  });

  it('reads range bounds', () => {
    expect(parseRsql('stock=btn=(1,9)')).toEqual({
      operator: 'and',
      values: [
        { property: 'stock', operator: 'between', start: '1', end: '9' },
      ],
    });
  });

  it.each([
    ['true', 'isNull'],
    ['false', 'isNotNull'],
  ])('resolves =isnull=%s to %s', (argument, operator) => {
    expect(parseRsql(`name=isnull=${argument}`).values[0]).toEqual({
      property: 'name',
      operator,
    });
  });

  it('unescapes a quoted value', () => {
    expect(parseRsql("name=='O\\'Neill'").values[0]).toEqual({
      property: 'name',
      operator: 'eq',
      value: "O'Neill",
    });
  });

  it('accepts double quotes as well as single', () => {
    expect(parseRsql('name=="a;b"').values[0]).toEqual({
      property: 'name',
      operator: 'eq',
      value: 'a;b',
    });
  });

  it('tolerates whitespace around the grammar', () => {
    expect(parseRsql('  name == Acme ; stock =gt= 10  ').values).toHaveLength(
      2,
    );
  });

  it.each([
    ['no expression', ''],
    ['only whitespace', '   '],
  ])('yields an empty group for %s', (_label, expression) => {
    expect(parseRsql(expression)).toEqual({ operator: 'and', values: [] });
  });

  it.each([
    ['a missing operator', 'name'],
    ['a missing property', '==Acme'],
    ['a missing value', 'name=='],
    ['an unterminated quote', "name=='Acme"],
    ['a trailing escape', "name=='Acme\\"],
    ['an unbalanced parenthesis', '(name==Acme'],
    ['trailing junk', 'name==Acme)'],
    ['an unterminated value list', 'status=in=(draft'],
    ['a missing value list', 'status=in=draft'],
    ['a non-boolean isnull argument', 'name=isnull=maybe'],
    ['the wrong number of range bounds', 'stock=btn=(1,2,3)'],
  ])('rejects %s', (_label, expression) => {
    expect(() => parseRsql(expression)).toThrow(/Invalid RSQL/);
  });

  it('rejects nesting past the depth limit', () => {
    const deep = `${'('.repeat(20)}a==1${')'.repeat(20)}`;

    expect(() => parseRsql(deep)).toThrow(/nesting deeper/);
  });

  it('rejects an expression past the node limit', () => {
    const wide = Array.from({ length: 200 }, (_, i) => `a==${i}`).join(';');

    expect(() => parseRsql(wide)).toThrow(/exceeds/);
  });
});

describe('coerceFiltering', () => {
  it('retypes each value from the member metadata', () => {
    expect(
      filter('stock=gt=10;active==true;releasedAt=lt=2026-07-21').values,
    ).toEqual([
      { property: 'stock', operator: 'gt', value: 10 },
      { property: 'active', operator: 'eq', value: true },
      {
        property: 'releasedAt',
        operator: 'lt',
        value: new Date('2026-07-21'),
      },
    ]);
  });

  it('retypes every entry of a value list', () => {
    expect(filter('stock=in=(1,2,3)').values[0]).toEqual({
      property: 'stock',
      operator: 'in',
      values: [1, 2, 3],
    });
  });

  it('retypes both range bounds', () => {
    expect(filter('stock=btn=(1,9)').values[0]).toEqual({
      property: 'stock',
      operator: 'between',
      start: 1,
      end: 9,
    });
  });

  it('carries a null check through with no argument', () => {
    expect(filter('name=isnull=true').values[0]).toEqual({
      property: 'name',
      operator: 'isNull',
    });
  });

  it('coerces inside a nested group', () => {
    expect(filter('stock=gt=1;(name==Acme,stock==2)').values[1]).toEqual({
      operator: 'or',
      values: [
        { property: 'name', operator: 'eq', value: 'Acme' },
        { property: 'stock', operator: 'eq', value: 2 },
      ],
    });
  });

  it('rewrites the accessor name to the wire key', () => {
    expect(filter('serial==abc').values[0]).toEqual({
      property: 'serial_no',
      operator: 'eq',
      value: 'abc',
    });
  });

  it('accepts the wire key directly', () => {
    expect(filter('serial_no==abc').values[0]).toEqual({
      property: 'serial_no',
      operator: 'eq',
      value: 'abc',
    });
  });

  it.each([
    ['an unknown member', 'nope==1'],
    ['a hidden member', 'secret==1'],
    ['a member that opted out of filtering', 'internal==1'],
  ])('rejects %s', (_label, expression) => {
    expect(() => filter(expression)).toThrow(/not a filterable member/);
  });

  it.each([
    ['a non-numeric number', 'stock==abc', /not a number/],
    ['an empty number', "stock==''", /not a number/],
    ['a non-boolean boolean', 'active==yes', /not a boolean/],
    ['an unparseable date', 'releasedAt==never', /not a date/],
    ['a value outside the enum', 'status==archived', /not a value of/],
  ])('rejects %s', (_label, expression, message) => {
    expect(() => filter(expression)).toThrow(message);
  });

  it('accepts a declared enum value', () => {
    expect(filter('status==draft').values[0]).toEqual({
      property: 'status',
      operator: 'eq',
      value: 'draft',
    });
  });
});

describe('round trip', () => {
  it.each([
    [
      'a single comparison',
      [{ property: 'name', operator: 'eq', value: 'Acme' }],
    ],
    [
      'typed values across members',
      [
        { property: 'stock', operator: 'gte', value: 10 },
        { property: 'active', operator: 'ne', value: false },
      ],
    ],
    [
      'a value list',
      [{ property: 'status', operator: 'in', values: ['draft', 'live'] }],
    ],
    ['a range', [{ property: 'stock', operator: 'between', start: 1, end: 9 }]],
    ['a null check', [{ property: 'name', operator: 'isNotNull' }]],
    [
      'a value carrying separators',
      [{ property: 'name', operator: 'like', value: "a;b,c'd" }],
    ],
    [
      'a mixed nested group',
      [
        {
          operator: 'and',
          values: [
            { property: 'stock', operator: 'gt', value: 1 },
            {
              operator: 'or',
              values: [
                { property: 'name', operator: 'eq', value: 'Acme' },
                { property: 'name', operator: 'eq', value: 'Globex' },
              ],
            },
          ],
        },
      ],
    ],
  ])('survives serialize → parse → coerce for %s', (_label, filtering) => {
    const typed = filtering as EntityFiltering<Widget>[];

    expect(filter(serializeRsql(typed)).values).toEqual(
      typed.length === 1 && 'operator' in typed[0] && !('property' in typed[0])
        ? (typed[0] as FilterGroup<Widget>).values
        : typed,
    );
  });

  it('survives a date round trip', () => {
    const value = new Date('2026-07-21T10:30:00.000Z');

    expect(
      filter(
        serializeRsql([
          { property: 'releasedAt', operator: 'eq', value },
        ] as EntityFiltering<Widget>[]),
      ).values[0],
    ).toEqual({ property: 'releasedAt', operator: 'eq', value });
  });
});

describe('sort parameter', () => {
  const sorting = (record: Record<number, unknown>) =>
    [record] as EntitySorting<Widget>[];

  it('signs each term and keeps precedence as list order', () => {
    expect(
      serializeSort(
        sorting({
          0: { property: 'name', type: 'asc' },
          1: { property: 'stock', type: 'desc' },
        }),
      ),
    ).toBe('+name,-stock');
  });

  it('orders by the numeric key, not by insertion', () => {
    expect(
      serializeSort(
        sorting({
          2: { property: 'stock', type: 'desc' },
          0: { property: 'name', type: 'asc' },
        }),
      ),
    ).toBe('+name,-stock');
  });

  it.each([
    ['no sorting', undefined],
    ['an empty array', []],
  ])('yields an empty parameter for %s', (_label, value) => {
    expect(serializeSort(value as EntitySorting<Widget>[])).toBe('');
  });

  it('skips a hole in the priority record', () => {
    expect(
      serializeSort(
        sorting({ 0: { property: 'name', type: 'asc' }, 1: undefined }),
      ),
    ).toBe('+name');
  });

  it('parses signs back into directions', () => {
    expect(parseSort(Widget, '+name,-stock')).toEqual([
      {
        0: { property: 'name', type: 'asc' },
        1: { property: 'stock', type: 'desc' },
      },
    ]);
  });

  it('treats an unsigned term as ascending', () => {
    expect(parseSort(Widget, 'name')).toEqual([
      { 0: { property: 'name', type: 'asc' } },
    ]);
  });

  it('rewrites the accessor name to the wire key', () => {
    expect(parseSort(Widget, 'serial')).toEqual([
      { 0: { property: 'serial_no', type: 'asc' } },
    ]);
  });

  it('ignores empty terms rather than failing on a stray comma', () => {
    expect(parseSort(Widget, 'name,,')).toEqual([
      { 0: { property: 'name', type: 'asc' } },
    ]);
  });

  it.each([
    ['no parameter', undefined],
    ['a null parameter', null],
    ['an empty parameter', ''],
    ['only whitespace', '  '],
    ['only separators', ',,'],
  ])('yields no sorting for %s', (_label, parameter) => {
    expect(parseSort(Widget, parameter)).toBeUndefined();
  });

  it.each([
    ['an unknown member', 'nope'],
    ['a hidden member', 'secret'],
    ['a member that opted out of sorting', 'internal'],
  ])('rejects %s', (_label, parameter) => {
    expect(() => parseSort(Widget, parameter)).toThrow(/not a sortable member/);
  });

  it('round-trips through serialize and parse', () => {
    const value = sorting({
      0: { property: 'name', type: 'desc' },
      1: { property: 'stock', type: 'asc' },
    });

    expect(parseSort(Widget, serializeSort(value))).toEqual(value);
  });
});

describe('load request parameters', () => {
  const params = (query: string) => new URLSearchParams(query);

  it('writes every part of a request', () => {
    const written = serializeLoadRequestParams<Widget>({
      filtering: [
        { property: 'name', operator: 'like', value: 'Acme' },
      ] as EntityFiltering<Widget>[],
      sorting: [
        { 0: { property: 'name', type: 'desc' } },
      ] as EntitySorting<Widget>[],
      page: 2,
      pageSize: 25,
    });

    expect(written.get('rsql')).toBe('name=like=Acme');
    expect(written.get('sort')).toBe('-name');
    expect(written.get('page')).toBe('2');
    expect(written.get('pageSize')).toBe('25');
  });

  it('omits empty parts rather than sending them blank', () => {
    const written = serializeLoadRequestParams<Widget>({ page: 1 });

    expect(written.has('rsql')).toBe(false);
    expect(written.has('sort')).toBe(false);
    expect(written.has('pageSize')).toBe(false);
    expect(written.toString()).toBe('page=1');
  });

  it('percent-encodes so the operators survive the URL', () => {
    const written = serializeLoadRequestParams<Widget>({
      filtering: [
        { property: 'name', operator: 'eq', value: 'Acme' },
        { property: 'stock', operator: 'gt', value: 1 },
      ] as EntityFiltering<Widget>[],
    });

    expect(written.toString()).toBe('rsql=name%3D%3DAcme%3Bstock%3Dgt%3D1');
  });

  it('parses a full query back into a request', () => {
    expect(
      parseLoadRequestParams(
        Widget,
        params('rsql=name==Acme&sort=-stock&page=3&pageSize=5'),
      ),
    ).toEqual({
      filtering: [
        {
          operator: 'and',
          values: [{ property: 'name', operator: 'eq', value: 'Acme' }],
        },
      ],
      sorting: [{ 0: { property: 'stock', type: 'desc' } }],
      page: 3,
      pageSize: 5,
    });
  });

  it('falls back to the default paging when none was sent', () => {
    expect(parseLoadRequestParams(Widget, params(''))).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it('honours caller-supplied defaults', () => {
    expect(
      parseLoadRequestParams(Widget, params(''), { page: 2, pageSize: 50 }),
    ).toEqual({ page: 2, pageSize: 50 });
  });

  it.each([
    ['an empty rsql parameter', 'rsql='],
    ['a whitespace rsql parameter', 'rsql=%20'],
    ['an empty sort parameter', 'sort='],
    ['blank paging parameters', 'page=&pageSize='],
  ])('ignores %s', (_label, query) => {
    expect(parseLoadRequestParams(Widget, params(query))).toEqual({
      page: 1,
      pageSize: 10,
    });
  });

  it('caps the page size so a client cannot ask for the whole table', () => {
    expect(
      parseLoadRequestParams(Widget, params('pageSize=100000')).pageSize,
    ).toBe(200);
  });

  it('honours a caller-supplied cap', () => {
    expect(
      parseLoadRequestParams(Widget, params('pageSize=500'), {
        maxPageSize: 20,
      }).pageSize,
    ).toBe(20);
  });

  it.each([
    ['a non-numeric page', 'page=abc'],
    ['a zero page', 'page=0'],
    ['a negative page', 'page=-1'],
    ['a fractional page', 'page=1.5'],
    ['a non-numeric page size', 'pageSize=abc'],
  ])('rejects %s', (_label, query) => {
    expect(() => parseLoadRequestParams(Widget, params(query))).toThrow(
      /must be a positive integer/,
    );
  });

  it('rejects a filter naming a member the entity did not expose', () => {
    expect(() =>
      parseLoadRequestParams(Widget, params('rsql=secret==x')),
    ).toThrow(/not a filterable member/);
  });

  it('round-trips a request through both ends', () => {
    const request = {
      filtering: [
        {
          operator: 'and',
          values: [
            { property: 'name', operator: 'like', value: 'Acme' },
            { property: 'stock', operator: 'gte', value: 3 },
          ],
        },
      ] as EntityFiltering<Widget>[],
      sorting: [
        { 0: { property: 'name', type: 'asc' } },
      ] as EntitySorting<Widget>[],
      page: 2,
      pageSize: 20,
    };

    expect(
      parseLoadRequestParams(Widget, serializeLoadRequestParams(request)),
    ).toEqual(request);
  });
});
