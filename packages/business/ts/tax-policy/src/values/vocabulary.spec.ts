import { describe, expect, it } from 'vitest';

import {
  isBuyerTaxIdType,
  isItemKind,
  isTaxBasis,
  isTaxRegime,
  isTaxTreatment,
} from '../index.js';

describe('the fiscal vocabularies', () => {
  it('narrows each closed set and refuses anything else', () => {
    expect(isTaxRegime('small-taxpayer')).toBe(true);
    expect(isTaxRegime('pequeño')).toBe(false);
    expect(isTaxRegime(1)).toBe(false);
    expect(isTaxTreatment('exempt')).toBe(true);
    expect(isTaxTreatment(undefined)).toBe(false);
    expect(isItemKind('service')).toBe(true);
    expect(isItemKind('bundle')).toBe(false);
    expect(isTaxBasis('gross')).toBe(true);
    expect(isTaxBasis(null)).toBe(false);
    expect(isBuyerTaxIdType('cui')).toBe(true);
    expect(isBuyerTaxIdType('dpi')).toBe(false);
  });
});
