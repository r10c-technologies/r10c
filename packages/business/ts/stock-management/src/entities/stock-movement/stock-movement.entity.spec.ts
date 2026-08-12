import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { StockMovement } from './stock-movement.entity.js';

describe('StockMovement', () => {
  it('serializes a signed quantity with its reason', () => {
    const movement = new StockMovement('offering-1', -1, 'sale');
    movement.id = 'mov-1';

    expect(serializeEntity(StockMovement, movement)).toEqual({
      id: 'mov-1',
      offeringId: 'offering-1',
      quantity: -1,
      reason: 'sale',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const movement = await Effect.runPromise(
      deserializeSingleEntity(StockMovement, {
        id: 'mov-2',
        offeringId: 'offering-2',
        quantity: 50,
        reason: 'receipt',
      }),
    );

    expect(movement?.quantity).toBe(50);
    expect(movement?.reason).toBe('receipt');
  });

  it('defaults to a zero adjustment, which changes nothing if written', () => {
    const movement = new StockMovement();

    expect(movement.offeringId).toBe('');
    expect(movement.quantity).toBe(0);
    expect(movement.reason).toBe('adjustment');
  });

  it('accepts the setters a repository writes back through', () => {
    const movement = new StockMovement();
    movement.offeringId = 'offering-3';
    movement.quantity = 1;
    movement.reason = 'cancellation';

    expect(movement.offeringId).toBe('offering-3');
    expect(movement.quantity).toBe(1);
    expect(movement.reason).toBe('cancellation');
  });

  it('signs direction into the quantity rather than a second member', () => {
    // One field cannot disagree with itself. A quantity plus a separate
    // direction can, and reconciling the ledger would then need a rule for
    // which of the two to believe.
    const names = describeEntityColumns(StockMovement).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'offeringId', 'quantity', 'reason']);
  });

  it('exposes the reason as a closed enum with a label vocabulary', () => {
    const reason = describeEntityColumns(StockMovement).find(
      column => column.name === 'reason',
    );

    expect(reason?.type).toBe('enum');
    expect(reason?.enumValues).toEqual([
      'receipt',
      'sale',
      'cancellation',
      'adjustment',
    ]);
    expect(reason?.filterable).toBe(true);
  });
});
