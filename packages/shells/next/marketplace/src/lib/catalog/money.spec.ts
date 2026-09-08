import { describe, expect, it } from 'vitest';

import { formatMoney } from './money';

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
