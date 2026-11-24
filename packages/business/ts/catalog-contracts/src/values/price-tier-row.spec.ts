import { extractMetaAccessors } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { PriceTierRow } from './price-tier-row.js';

describe('PriceTierRow', () => {
  it('holds a from and an amount, zero until set', () => {
    const row = new PriceTierRow();
    expect([row.from, row.amount]).toEqual([0, 0]);

    row.from = 10_000;
    row.amount = 950;

    expect([row.from, row.amount]).toEqual([10_000, 950]);
    expect([
      new PriceTierRow(5, 7).from,
      new PriceTierRow(5, 7).amount,
    ]).toEqual([5, 7]);
  });

  it('describes both members, with no unit or currency of its own', () => {
    const accessors = extractMetaAccessors(PriceTierRow);

    expect(accessors.map(one => one.name)).toEqual(['from', 'amount']);
    expect(
      accessors.every(
        one => one.money === undefined && one.scaled === undefined,
      ),
    ).toBe(true);
  });
});
