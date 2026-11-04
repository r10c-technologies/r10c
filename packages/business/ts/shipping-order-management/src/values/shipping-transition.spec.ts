import { describe, expect, it } from 'vitest';

import { isShippingStatus, ShippingStatuses } from './shipping-status.js';
import {
  shippingStatusAfter,
  ShippingTransitions,
  STAMP_OF,
} from './shipping-transition.js';

/** The whole lifecycle, stated once more by hand: every pair not here is illegal. */
const LEGAL: Record<string, string> = {
  'awaiting-dispatch hold': 'held',
  'held release': 'awaiting-dispatch',
  'awaiting-dispatch withdraw': 'withdrawn',
  'held withdraw': 'withdrawn',
  'awaiting-dispatch dispatch': 'dispatched',
  'dispatched record-delivery': 'delivered',
  'dispatched record-refusal': 'refused',
  'refused record-return': 'returned',
};

describe('shippingStatusAfter', () => {
  const pairs = ShippingStatuses.flatMap(status =>
    ShippingTransitions.map(transition => [status, transition] as const),
  );

  it.each(pairs)('%s × %s', (status, transition) => {
    expect(shippingStatusAfter(status, transition)).toBe(
      LEGAL[`${status} ${transition}`],
    );
  });

  it('takes back only a refused parcel: a delivered one is the delivery flow’s end', () => {
    expect(shippingStatusAfter('delivered', 'record-return')).toBeUndefined();
  });

  it('never dispatches a held shipment, so a hold and a dispatch cannot both win', () => {
    expect(shippingStatusAfter('held', 'dispatch')).toBeUndefined();
    expect(shippingStatusAfter('dispatched', 'hold')).toBeUndefined();
  });
});

describe('STAMP_OF', () => {
  it('stamps the four moments a courier report or a dispatch records', () => {
    expect(STAMP_OF).toEqual({
      dispatch: 'dispatchedAt',
      'record-delivery': 'deliveredAt',
      'record-refusal': 'refusedAt',
      'record-return': 'returnedAt',
    });
  });
});

describe('isShippingStatus', () => {
  it.each(ShippingStatuses)('accepts %s', status => {
    expect(isShippingStatus(status)).toBe(true);
  });

  it.each(['shipped', undefined, 3])('rejects %s', value => {
    expect(isShippingStatus(value)).toBe(false);
  });
});
