import { describe, expect, it } from 'vitest';

import { totalsByCurrency } from './money';

describe('totalsByCurrency', () => {
  it('multiplies each line by its quantity', () => {
    expect(
      totalsByCurrency([
        { amount: 1999, currency: 'GTQ', quantity: 2 },
        { amount: 500, currency: 'GTQ', quantity: 1 },
      ]),
    ).toEqual([{ currency: 'GTQ', amount: 4498 }]);
  });

  /** #328: no exchange rate, so two currencies are two figures. */
  it('keeps one total per currency, in first-seen order', () => {
    expect(
      totalsByCurrency([
        { amount: 1000, currency: 'USD', quantity: 1 },
        { amount: 2000, currency: 'GTQ', quantity: 1 },
        { amount: 300, currency: 'USD', quantity: 2 },
      ]),
    ).toEqual([
      { currency: 'USD', amount: 1600 },
      { currency: 'GTQ', amount: 2000 },
    ]);
  });

  it('is empty for no lines', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});
