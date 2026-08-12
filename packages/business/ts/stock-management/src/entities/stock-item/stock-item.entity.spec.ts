import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { StockItem } from './stock-item.entity.js';

describe('StockItem', () => {
  it('serializes the offering and both counters', () => {
    const item = new StockItem('offering-1');
    item.id = 'stock-1';
    item.onHand = 50;
    item.reserved = 3;

    expect(serializeEntity(StockItem, item)).toEqual({
      id: 'stock-1',
      offeringId: 'offering-1',
      onHand: 50,
      reserved: 3,
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

  it('carries no availability member, because it is derived', () => {
    // `onHand - reserved` is computed at read time. Storing it would be a third
    // counter to keep consistent with the two that are actually written, and
    // the first place a lost update could hide.
    const names = describeEntityColumns(StockItem).map(column => column.name);

    expect(names).toEqual(['id', 'offeringId', 'onHand', 'reserved']);
  });

  it('makes both counters filterable, since the checkout guard spans them', () => {
    // The conditional write is `onHand - reserved >= qty`; member metadata is
    // also the server-side allowlist, so a counter that is not filterable
    // cannot appear in that predicate.
    const filterable = describeEntityColumns(StockItem)
      .filter(column => column.filterable)
      .map(column => column.name);

    expect(filterable).toContain('onHand');
    expect(filterable).toContain('reserved');
    expect(filterable).toContain('offeringId');
  });
});
