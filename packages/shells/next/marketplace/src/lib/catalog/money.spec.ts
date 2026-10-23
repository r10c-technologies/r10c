import { describe, expect, it } from 'vitest';

import { formatMoney, totalsByCurrency } from './money';

/**
 * ⚠️ The unit conversion is the whole point. `amount` is an integer number of
 * cents on the projection, so a renderer that forgets the division shows a lamp
 * for nineteen thousand nine hundred and ninety — visibly wrong on a
 * three-digit price and easy to miss on a two-digit one.
 */
describe('formatMoney', () => {
  it('reads the amount as minor units', () => {
    expect(formatMoney('en', 1999, 'USD')).toContain('19.99');
  });

  it('keeps the cents on a round amount', () => {
    expect(formatMoney('en', 2000, 'USD')).toContain('20.00');
  });

  // `Intl` decides the symbol and the separators from the pair, which is why
  // the currency is never concatenated by hand.
  it('renders the currency the locale would', () => {
    expect(formatMoney('en', 1999, 'USD')).toContain('$');
    expect(formatMoney('es', 1999, 'EUR')).toContain('€');
  });

  /**
   * A bad code is a projection carrying bad data, not a rendering problem — so
   * the page still renders. `Intl` throws on an unknown currency, and an
   * uncaught throw inside a prerendered page would fail the build.
   */
  it('falls back to the bare amount for a currency Intl rejects', () => {
    expect(formatMoney('es', 1999, 'not-a-currency')).toBe(
      '19.99 not-a-currency',
    );
  });
});

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
