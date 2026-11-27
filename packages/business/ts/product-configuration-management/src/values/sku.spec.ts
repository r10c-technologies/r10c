import { describe, expect, it } from 'vitest';

import { isSku, normalizedSku, SKU_MAX_LENGTH } from './sku.js';

describe('normalizedSku', () => {
  it('trims, and reads nothing left as no SKU', () => {
    expect(normalizedSku(' TAC-8 ')).toBe('TAC-8');
    expect(normalizedSku('  ')).toBeUndefined();
    expect(normalizedSku(undefined)).toBeUndefined();
  });
});

describe('isSku', () => {
  it('takes what a label prints, up to the limit', () => {
    expect(isSku('TOR-8/500_CAJA.v2')).toBe(true);
    expect(isSku('A'.repeat(SKU_MAX_LENGTH))).toBe(true);
  });

  it('refuses a space, a symbol a scanner would not type, and a long code', () => {
    expect(isSku('TAC 8')).toBe(false);
    expect(isSku('TAC#8')).toBe(false);
    expect(isSku('A'.repeat(SKU_MAX_LENGTH + 1))).toBe(false);
  });
});
