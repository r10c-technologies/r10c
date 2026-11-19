import { describe, expect, it } from 'vitest';

import { taxDocument, type TaxLineInput } from './document-tax.js';
import type { TaxRule } from './tax-rule.js';

const GENERAL: TaxRule = { rateBasisPoints: 1200, basis: 'inclusive' };
const SMALL: TaxRule = { rateBasisPoints: 500, basis: 'gross' };

const taxed = (gross: number): TaxLineInput => ({ gross, treatment: 'taxed' });

describe('taxDocument', () => {
  it('breaks IVA out of an inclusive price', () => {
    const document = taxDocument([taxed(11_200)], GENERAL);
    expect(document).toEqual({
      lines: [{ taxableBase: 10_000, taxAmount: 1_200, taxRate: 1200 }],
      netAmount: 10_000,
      taxAmount: 1_200,
      totalAmount: 11_200,
    });
  });

  it('rounds once per document, not per line', () => {
    // Seven lines of 5 centavos: per line each would break out
    // 5 − round(4.46) = 1, owing 7; the document owes 35 − round(31.25) = 4.
    const seven = taxDocument(
      Array.from({ length: 7 }, () => taxed(5)),
      GENERAL,
    );
    expect(seven.taxAmount).toBe(4);
    expect(seven.lines.reduce((sum, line) => sum + line.taxAmount, 0)).toBe(4);
    expect(seven.netAmount + seven.taxAmount).toBe(seven.totalAmount);
  });

  it('apportions by largest remainder, ties to the earlier line', () => {
    const document = taxDocument([taxed(100), taxed(100), taxed(100)], GENERAL);
    // round(300 − 300/1.12) = round(32.14) = 32 → 11, 11, 10.
    expect(document.lines.map(line => line.taxAmount)).toEqual([11, 11, 10]);
    expect(document.lines.map(line => line.taxableBase)).toEqual([89, 89, 90]);
  });

  it('gives a bigger remainder the extra centavo before a tie', () => {
    const document = taxDocument([taxed(50), taxed(250)], GENERAL);
    // 32 split 50:250 → 5.33 and 26.67 → 5 and 27.
    expect(document.lines.map(line => line.taxAmount)).toEqual([5, 27]);
  });

  it('leaves an exempt line untaxed and out of the apportioning', () => {
    const document = taxDocument(
      [taxed(11_200), { gross: 5_000, treatment: 'exempt' }],
      GENERAL,
    );
    expect(document.lines[1]).toEqual({
      taxableBase: 5_000,
      taxAmount: 0,
      taxRate: 0,
    });
    expect(document).toMatchObject({
      netAmount: 15_000,
      taxAmount: 1_200,
      totalAmount: 16_200,
    });
  });

  it('applies a gross rule to the price without breaking anything out', () => {
    const document = taxDocument([taxed(10_000), taxed(333)], SMALL);
    expect(document.taxAmount).toBe(517);
    expect(document.lines.map(line => line.taxableBase)).toEqual([10_000, 333]);
    expect(document.netAmount).toBe(document.totalAmount);
  });

  it('owes nothing on an all-exempt or empty document', () => {
    expect(
      taxDocument([{ gross: 900, treatment: 'exempt' }], GENERAL).taxAmount,
    ).toBe(0);
    expect(taxDocument([], GENERAL)).toEqual({
      lines: [],
      netAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    });
  });

  it('keeps every line summing to the document across many baskets', () => {
    for (let seed = 1; seed < 200; seed++) {
      const lines = Array.from({ length: (seed % 6) + 1 }, (_, index) =>
        taxed(((seed * 7919 + index * 104_729) % 50_000) + 1),
      );
      const document = taxDocument(lines, GENERAL);
      expect(
        document.lines.reduce((sum, line) => sum + line.taxAmount, 0),
      ).toBe(document.taxAmount);
      expect(document.netAmount + document.taxAmount).toBe(
        document.totalAmount,
      );
    }
  });
});
