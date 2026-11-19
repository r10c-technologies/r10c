import type { TaxRule } from './tax-rule';
import type { TaxTreatment } from './tax-treatment';

/** One line of a document: its gross (unit price × quantity, minor units). */
export interface TaxLineInput {
  readonly gross: number;
  readonly treatment: TaxTreatment;
}

/** What the document says about one line. */
export interface TaxedLine {
  readonly taxableBase: number;
  readonly taxAmount: number;
  /** The rate applied, in basis points; `0` on an exempt line. */
  readonly taxRate: number;
}

/** A whole document: its lines, and their sums. */
export interface TaxedDocument {
  readonly lines: readonly TaxedLine[];
  readonly netAmount: number;
  readonly taxAmount: number;
  readonly totalAmount: number;
}

const WHOLE = 10_000n;

/** `numerator / denominator`, rounded half up, on non-negative integers. */
const roundedDiv = (numerator: bigint, denominator: bigint): bigint =>
  (2n * numerator + denominator) / (2n * denominator);

/**
 * The tax a document owes on `taxedGross`, rounded **once per document**
 * (Q13): rounding per line would let a basket of many cheap lines owe a
 * different tax than the same goods sold as one line.
 */
const documentTaxOf = (taxedGross: bigint, rule: TaxRule): bigint => {
  const rate = BigInt(rule.rateBasisPoints);
  return rule.basis === 'inclusive'
    ? taxedGross - roundedDiv(taxedGross * WHOLE, WHOLE + rate)
    : roundedDiv(taxedGross * rate, WHOLE);
};

/**
 * Spread `total` over `weights` in proportion, by largest remainder, so the
 * parts are whole minor units and always sum to `total` exactly. Ties go to
 * the earlier line, so the split is deterministic.
 */
const apportion = (total: bigint, weights: readonly bigint[]): bigint[] => {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = weights.map(weight => (total * weight) / sum);
  const remainders = weights.map(weight => (total * weight) % sum);
  const left = Number(total - parts.reduce((acc, part) => acc + part, 0n));
  const bonus = new Set(
    remainders
      .map((remainder, index) => ({ remainder, index }))
      .sort((a, b) =>
        a.remainder === b.remainder
          ? a.index - b.index
          : a.remainder > b.remainder
            ? -1
            : 1,
      )
      .slice(0, left)
      .map(({ index }) => index),
  );
  return parts.map((part, index) => (bonus.has(index) ? part + 1n : part));
};

/**
 * The tax breakdown of one document — one vendor's order — under its
 * seller's rule.
 *
 * The tax is computed once over the taxed lines' gross and apportioned back to
 * them, so the lines always sum to the document. On an `inclusive` rule a
 * line's base is its gross less its tax, and `net + tax = total`; on a `gross`
 * rule nothing is broken out of the price, the base is the gross, and the tax
 * is what the seller owes on it — so `net = total` there, by definition.
 */
export const taxDocument = (
  lines: readonly TaxLineInput[],
  rule: TaxRule,
): TaxedDocument => {
  const taxedWeights = lines.map(line =>
    line.treatment === 'taxed' ? BigInt(line.gross) : 0n,
  );
  const taxedGross = taxedWeights.reduce((acc, gross) => acc + gross, 0n);
  const shares = apportion(documentTaxOf(taxedGross, rule), taxedWeights);
  const taxed = lines.map((line, index): TaxedLine => {
    if (line.treatment === 'exempt')
      return { taxableBase: line.gross, taxAmount: 0, taxRate: 0 };
    const taxAmount = Number(shares.at(index));
    return {
      taxableBase:
        rule.basis === 'inclusive' ? line.gross - taxAmount : line.gross,
      taxAmount,
      taxRate: rule.rateBasisPoints,
    };
  });
  return {
    lines: taxed,
    netAmount: taxed.reduce((acc, line) => acc + line.taxableBase, 0),
    taxAmount: taxed.reduce((acc, line) => acc + line.taxAmount, 0),
    totalAmount: lines.reduce((acc, line) => acc + line.gross, 0),
  };
};
