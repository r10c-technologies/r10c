import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { StockItem } from './stock-item.entity.js';

describe('StockItem', () => {
  it('serializes the offering and both counters', () => {
    const item = new StockItem('offering-1');
    item.id = 'stock-1';
    item.unit = 'M';
    item.onHand = 50;
    item.reserved = 3;
    item.available = 47;

    expect(serializeEntity(StockItem, item)).toEqual({
      id: 'stock-1',
      offeringId: 'offering-1',
      unit: 'M',
      onHand: 50,
      reserved: 3,
      available: 47,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const item = await Effect.runPromise(
      deserializeSingleEntity(StockItem, {
        id: 'stock-2',
        offeringId: 'offering-2',
        onHand: 12,
        reserved: 12,
      }),
    );

    expect(item?.offeringId).toBe('offering-2');
    expect(item?.onHand).toBe(12);
    expect(item?.reserved).toBe(12);
  });

  it('starts at zero on both counters, so nothing is available by default', () => {
    const item = new StockItem();

    expect(item.offeringId).toBe('');
    expect(item.onHand).toBe(0);
    expect(item.reserved).toBe(0);
  });

  it('carries what is available, sortable and filterable (#555)', () => {
    // `onHand - reserved` is stored because a list has to sort and filter on
    // it; the ledger moves it in the same update as the counter that moved, so
    // it is never a third value read-modify-written (ADR 0010).
    const columns = describeEntityColumns(StockItem);
    const available = columns.find(column => column.name === 'available');

    expect(columns.map(column => column.name)).toEqual([
      'id',
      'offeringId',
      'unit',
      'onHand',
      'reserved',
      'available',
    ]);
    expect(available).toMatchObject({ sortable: true, filterable: true });
  });

  it('queries no counter whose number means something else on the next row (ADR 0082 §4)', () => {
    // 3500 is 3.5 m on one item and 3,500 pieces on the next, so a list cannot
    // order or filter on it. `available` stays both: a zero means the same in
    // every unit, and the out-of-stock tile and the list's order read it. The
    // checkout's guard is the store's own conditional write, never a query.
    const columns = describeEntityColumns(StockItem);
    const column = (name: string) =>
      columns.find(candidate => candidate.name === name);

    for (const name of ['onHand', 'reserved']) {
      expect(column(name)).toMatchObject({
        sortable: false,
        filterable: false,
      });
    }
    expect(column('unit')).toMatchObject({ filterable: true });
    expect(column('onHand')?.scaled).toMatchObject({ unitMember: 'unit' });
  });
});
