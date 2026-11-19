import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { StockMovement } from '../entities/stock-movement/index.js';
import {
  STOCK_MOVEMENT_RECORDED,
  stockMovementRecordedEvent,
  StockMovementRecordSchema,
} from './stock-movement-recorded.js';

const movement = (cause?: {
  type: 'reservation' | 'product-order';
  id: string;
}) => {
  const recorded = new StockMovement('off-1', -2, 'sale');
  recorded.id = 'mov-1';
  recorded.occurredAt = new Date('2026-11-19T10:00:00.000Z');
  if (cause !== undefined) {
    recorded.causeType = cause.type;
    recorded.causeId = cause.id;
  }
  return recorded;
};

describe('stockMovementRecordedEvent', () => {
  it('is the ledger line itself, for nobody’s browser', () => {
    const event = stockMovementRecordedEvent(
      'org-1',
      movement({ type: 'reservation', id: 'res-1' }),
      'stock',
    );

    expect(event).toEqual({
      name: STOCK_MOVEMENT_RECORDED,
      id: 'mov-1',
      source: 'stock',
      at: '2026-11-19T10:00:00.000Z',
      correlationId: 'off-1',
      aggregate: { type: 'stock-movement', id: 'mov-1' },
      version: 1,
      data: {
        id: 'mov-1',
        organizationId: 'org-1',
        offeringId: 'off-1',
        quantity: -2,
        reason: 'sale',
        occurredAt: '2026-11-19T10:00:00.000Z',
        cause: { type: 'reservation', id: 'res-1' },
      },
    });
    expect(Schema.is(StockMovementRecordSchema)(event.data)).toBe(true);
  });

  it('names the movement as its own document when nothing else caused it', () => {
    const { data } = stockMovementRecordedEvent('org-1', movement(), 'stock');

    expect(data.cause).toEqual({ type: 'manual', id: 'mov-1' });
  });

  it('stamps a movement that carries no time with the moment it is announced', () => {
    const undated = movement();
    undated.occurredAt = undefined;

    const { data } = stockMovementRecordedEvent('org-1', undated, 'stock');

    expect(Number.isNaN(Date.parse(data.occurredAt))).toBe(false);
  });
});
