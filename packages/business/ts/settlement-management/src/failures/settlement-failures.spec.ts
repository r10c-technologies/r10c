import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { MixedCurrencies } from './settlement-failures.js';

describe('MixedCurrencies', () => {
  it('is an invalid failure naming the vendor and both currencies', () => {
    const mixed = new MixedCurrencies({
      vendorId: 'v-1',
      currencies: ['GTQ', 'USD'],
    });

    expect(isFailure(mixed)).toBe(true);
    expect([mixed.code, mixed.category]).toEqual([
      'mixedCurrencies',
      'invalid',
    ]);
    expect(mixed.message).toBe(
      'vendor v-1 has amounts in GTQ and USD together',
    );
  });
});
