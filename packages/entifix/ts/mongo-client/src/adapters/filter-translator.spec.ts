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
});
