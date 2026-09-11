import { describe, expect, it } from 'vitest';

import {
  fulfilLines,
  isLegalOrderTransition,
  orderStatusAfter,
  OrderTransitions,
  statusAfterFulfilling,
} from './order-transition.js';

const AT = new Date('2026-09-11T12:00:00.000Z');
const EARLIER = new Date('2026-09-10T08:00:00.000Z');

const line = (vendorId: string, fulfilledAt?: Date) => ({
  vendorId,
  fulfilledAt,
});

describe('OrderTransitions', () => {
  it('names what an order can be asked to do after the money moved', () => {
    expect(OrderTransitions).toEqual([
      'fulfil',
      'claim-cancel',
      'settle-cancel',
    ]);
  });
});

describe('orderStatusAfter', () => {
  it('claims a paid order for cancellation', () => {
    expect(orderStatusAfter('paid', 'claim-cancel')).toBe('cancelling');
  });

  it('settles a claimed cancellation', () => {
    expect(orderStatusAfter('cancelling', 'settle-cancel')).toBe('cancelled');
  });

  it('refuses a second claim on a record already claimed', () => {
    // The refusal *is* the lock. A `cancelling -> cancelling` entry would let
    // two flows refund one order.
    expect(orderStatusAfter('cancelling', 'claim-cancel')).toBeUndefined();
  });

  it('refuses to cancel an order still in flight', () => {
    // Undoing a `pending` order is the coordinator's job; a second actor would
    // race a compensation already on its way.
    expect(orderStatusAfter('pending', 'claim-cancel')).toBeUndefined();
  });

  it('refuses to cancel a fulfilled order, which is a return', () => {
    expect(orderStatusAfter('fulfilled', 'claim-cancel')).toBeUndefined();
    expect(orderStatusAfter('cancelled', 'claim-cancel')).toBeUndefined();
  });

  it('holds a paid order at `paid` on fulfil, leaving the lines to decide', () => {
    expect(orderStatusAfter('paid', 'fulfil')).toBe('paid');
  });

  it('refuses to fulfil anything that is not paid', () => {
    expect(orderStatusAfter('pending', 'fulfil')).toBeUndefined();
    expect(orderStatusAfter('cancelling', 'fulfil')).toBeUndefined();
    expect(orderStatusAfter('cancelled', 'fulfil')).toBeUndefined();
  });

  it('refuses to settle a cancellation nobody claimed', () => {
    expect(orderStatusAfter('paid', 'settle-cancel')).toBeUndefined();
  });
});

describe('isLegalOrderTransition', () => {
  it('answers the table', () => {
    expect(isLegalOrderTransition('paid', 'claim-cancel')).toBe(true);
    expect(isLegalOrderTransition('cancelled', 'claim-cancel')).toBe(false);
  });
});

describe('fulfilLines', () => {
  it('stamps every line for an operator', () => {
    const result = fulfilLines([line('alpha'), line('beta')], undefined, AT);

    expect(result.touched).toBe(2);
    expect(result.lines.map(item => item.fulfilledAt)).toEqual([AT, AT]);
  });

  it('stamps only the lines a vendor owes', () => {
    const result = fulfilLines([line('alpha'), line('beta')], 'alpha', AT);

    expect(result.touched).toBe(1);
    expect(result.lines[0].fulfilledAt).toBe(AT);
    expect(result.lines[1].fulfilledAt).toBeUndefined();
  });

  it('keeps the first stamp when a line is fulfilled twice', () => {
    // A vendor clicking twice, or a retry after a timed-out response, must not
    // move the moment a promise was kept.
    const result = fulfilLines([line('alpha', EARLIER)], 'alpha', AT);

    expect(result.touched).toBe(0);
    expect(result.lines[0].fulfilledAt).toBe(EARLIER);
  });

  it('touches nothing when no line is in scope', () => {
    const result = fulfilLines([line('alpha')], 'beta', AT);

    expect(result.touched).toBe(0);
    expect(result.lines[0].fulfilledAt).toBeUndefined();
  });
});

describe('statusAfterFulfilling', () => {
  it('reaches `fulfilled` only when every line carries a stamp', () => {
    expect(statusAfterFulfilling([line('alpha', AT), line('beta', AT)])).toBe(
      'fulfilled',
    );
  });

  it('stays `paid` while another vendor still owes a line', () => {
    expect(statusAfterFulfilling([line('alpha', AT), line('beta')])).toBe(
      'paid',
    );
  });

  it('does not fulfil an empty order by vacuous truth', () => {
    expect(statusAfterFulfilling([])).toBe('paid');
  });
});
