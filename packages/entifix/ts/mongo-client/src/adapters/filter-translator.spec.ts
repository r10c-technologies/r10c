import type {
  Entity,
  EntityFiltering,
  EntitySorting,
} from '@r10c/entifix-ts-core';

import { translateFiltering, translateSorting } from './filter-translator.js';

interface Product extends Entity {
  id: string;
  name: string;
  price: number;
}

describe('translateFiltering', () => {
  it('returns match-all for absent/empty filtering', () => {
    expect(translateFiltering<Product>()).toEqual({});
    expect(translateFiltering<Product>([])).toEqual({});
  });

  it('maps binary operators', () => {
    const filtering: EntityFiltering<Product>[] = [
      { property: 'price', operator: 'gte', value: 10 },
    ];
    expect(translateFiltering(filtering)).toEqual({ price: { $gte: 10 } });
  });

  it('maps array, range, string and null operators', () => {
    expect(
      translateFiltering<Product>([
        { property: 'id', operator: 'in', values: ['a', 'b'] },
      ]),
    ).toEqual({ id: { $in: ['a', 'b'] } });

    expect(
      translateFiltering<Product>([
        { property: 'price', operator: 'between', start: 1, end: 5 },
      ]),
    ).toEqual({ price: { $gte: 1, $lte: 5 } });

    expect(
      translateFiltering<Product>([
        { property: 'name', operator: 'like', value: 'a.b' },
      ]),
    ).toEqual({ name: { $regex: 'a\\.b', $options: 'i' } });

    expect(
      translateFiltering<Product>([
        { property: 'name', operator: 'isNull' },
      ]),
    ).toEqual({ name: { $eq: null } });
  });

  // Every operator the entity filtering vocabulary defines has to translate;
  // an unmapped one would silently widen a query to match everything.
  it.each([
    ['eq', { property: 'name', operator: 'eq', value: 'a' }, { name: { $eq: 'a' } }],
    ['ne', { property: 'name', operator: 'ne', value: 'a' }, { name: { $ne: 'a' } }],
    ['gt', { property: 'price', operator: 'gt', value: 1 }, { price: { $gt: 1 } }],
    ['lt', { property: 'price', operator: 'lt', value: 1 }, { price: { $lt: 1 } }],
    ['lte', { property: 'price', operator: 'lte', value: 1 }, { price: { $lte: 1 } }],
    [
      'nin',
      { property: 'id', operator: 'nin', values: ['a'] },
      { id: { $nin: ['a'] } },
    ],
    [
      'nbetween',
      { property: 'price', operator: 'nbetween', start: 1, end: 5 },
      { price: { $not: { $gte: 1, $lte: 5 } } },
    ],
    [
      'nlike',
      { property: 'name', operator: 'nlike', value: 'a+b' },
      { name: { $not: { $regex: 'a\\+b', $options: 'i' } } },
    ],
    [
      'isNotNull',
      { property: 'name', operator: 'isNotNull' },
      { name: { $ne: null } },
    ],
  ])('maps %s', (_label, filter, expected) => {
    expect(
      translateFiltering<Product>([filter as EntityFiltering<Product>]),
    ).toEqual(expected);
  });

  // A single entry stays unwrapped: `{ price: {...} }` rather than
  // `{ $and: [ { price: {...} } ] }`, which Mongo would treat identically but
  // which reads far worse in a profiler.
  it('does not wrap a single clause in $and', () => {
    expect(
      translateFiltering<Product>([{ property: 'price', operator: 'gte', value: 10 }]),
    ).toEqual({ price: { $gte: 10 } });
  });

  it('flattens an entry that is itself an array of filters', () => {
    expect(
      translateFiltering<Product>([
        [
          { property: 'price', operator: 'gte', value: 10 },
          { property: 'name', operator: 'eq', value: 'a' },
        ],
      ]),
    ).toEqual({
      $and: [{ price: { $gte: 10 } }, { name: { $eq: 'a' } }],
    });
  });

  it('yields match-all for an entry that is an empty array', () => {
    expect(translateFiltering<Product>([[]])).toEqual({});
  });

  it('AND-combines an explicit and-group', () => {
    expect(
      translateFiltering<Product>([
        {
          operator: 'and',
          values: [
            { property: 'price', operator: 'gt', value: 1 },
            { property: 'price', operator: 'lt', value: 9 },
          ],
        },
      ]),
    ).toEqual({ $and: [{ price: { $gt: 1 } }, { price: { $lt: 9 } }] });
  });

  // The `default` arm is an exhaustiveness guard: adding an operator to the
  // vocabulary without a translation here is a compile error. Reaching it at
  // runtime takes a cast, and what comes back is the node itself — not a
  // match-all, which is the outcome that would matter.
  it('does not degrade to match-all for an operator it does not know', () => {
    const unknownOperator = {
      property: 'name',
      operator: 'unknown',
    } as unknown as EntityFiltering<Product>;

    expect(translateFiltering<Product>([unknownOperator])).not.toEqual({});
  });

  it('AND-combines multiple top-level entries', () => {
    const filtering: EntityFiltering<Product>[] = [
      { property: 'price', operator: 'gte', value: 10 },
      { property: 'name', operator: 'like', value: 'x' },
    ];
    expect(translateFiltering(filtering)).toEqual({
      $and: [
        { price: { $gte: 10 } },
        { name: { $regex: 'x', $options: 'i' } },
      ],
    });
  });

  it('translates a logic FilterGroup', () => {
    const filtering: EntityFiltering<Product>[] = [
      {
        operator: 'or',
        values: [
          { property: 'price', operator: 'lt', value: 5 },
          { property: 'price', operator: 'gt', value: 100 },
        ],
      },
    ];
    expect(translateFiltering(filtering)).toEqual({
      $or: [{ price: { $lt: 5 } }, { price: { $gt: 100 } }],
    });
  });
});

describe('translateSorting', () => {
  it('maps asc/desc by numeric priority', () => {
    const sorting: EntitySorting<Product>[] = [
      { 1: { property: 'name', type: 'asc' }, 0: { property: 'price', type: 'desc' } },
    ];
    const result = translateSorting(sorting);
    expect(result).toEqual({ price: -1, name: 1 });
    // priority 0 (price) precedes priority 1 (name)
    expect(Object.keys(result)).toEqual(['price', 'name']);
  });

  it('returns empty for absent sorting', () => {
    expect(translateSorting<Product>()).toEqual({});
  });

  it('skips a priority slot that carries nothing', () => {
    const sorting = [
      { 0: undefined, 1: { property: 'name', type: 'asc' } },
    ] as unknown as EntitySorting<Product>[];

    expect(translateSorting(sorting)).toEqual({ name: 1 });
  });

  it('merges several sorting records in order', () => {
    const sorting: EntitySorting<Product>[] = [
      { 0: { property: 'price', type: 'desc' } },
      { 0: { property: 'name', type: 'asc' } },
    ];

    expect(Object.keys(translateSorting(sorting))).toEqual(['price', 'name']);
  });
});
