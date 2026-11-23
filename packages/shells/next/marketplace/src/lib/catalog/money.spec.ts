import { describe, expect, it } from 'vitest';

import { totalsByCurrency } from './money';

describe('totalsByCurrency', () => {
  it('sums what each line cost, and never multiplies again (ADR 0082 §6)', () => {
    expect(
      totalsByCurrency([
        { lineTotal: 3998, currency: 'GTQ' },
        { lineTotal: 500, currency: 'GTQ' },
      ]),
    ).toEqual([{ currency: 'GTQ', amount: 4498 }]);
  });

  /** #328: no exchange rate, so two currencies are two figures. */
  it('keeps one total per currency, in first-seen order', () => {
    expect(
      totalsByCurrency([
        { lineTotal: 1000, currency: 'USD' },
        { lineTotal: 2000, currency: 'GTQ' },
        { lineTotal: 600, currency: 'USD' },
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
