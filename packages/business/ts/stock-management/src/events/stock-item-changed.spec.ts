import { describe, expect, it } from 'vitest';

import {
  STOCK_ITEM_CHANGED,
  stockItemChangedEvent,
} from './stock-item-changed.js';

describe('stockItemChangedEvent', () => {
  it('is the item’s change at its ledger version, for its organization alone', () => {
    const event = stockItemChangedEvent(
      'org-1',
      { id: 'item-1', offeringId: 'off-1', onHand: 5, reserved: 2, version: 7 },
      'stock',
    );

    expect(event).toMatchObject({
      name: STOCK_ITEM_CHANGED,
      id: 'item-1:7',
      source: 'stock',
      aggregate: { type: 'stock-item', id: 'item-1' },
      version: 7,
      audience: [{ kind: 'organization', id: 'org-1' }],
      data: { id: 'item-1', offeringId: 'off-1', onHand: 5, reserved: 2 },
    });
  });
});
