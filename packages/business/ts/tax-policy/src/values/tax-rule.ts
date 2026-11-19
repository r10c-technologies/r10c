import { isTaxRegime, type TaxRegime, TaxRegimes } from './tax-regime';

/**
 * How a rate applies to a price.
 *
 * - `inclusive` — the consumer price already includes the tax, and the
 *   document breaks it out: `base = gross / (1 + rate)`, `tax = gross − base`.
 * - `gross` — the rate applies to the gross itself, and the document shows no
 *   tax: `tax = gross × rate`, `base = gross`. The seller owes it out of the
 *   price; the buyer is not charged it on top.
 */
export const TaxBases = ['inclusive', 'gross'] as const;

export type TaxBasis = (typeof TaxBases)[number];

export const isTaxBasis = (value: unknown): value is TaxBasis =>
  typeof value === 'string' && (TaxBases as readonly string[]).includes(value);

/** One regime's rate, in basis points (`1200` = 12 %), and how it applies. */
export interface TaxRule {
  readonly rateBasisPoints: number;
  readonly basis: TaxBasis;
}

/** Every regime's rule — what the coordinator reads from the `tax` group. */
export type TaxRules = Readonly<Record<TaxRegime, TaxRule>>;

/** Why a configured rule set was refused. */
export type TaxRulesProblem =
  | { readonly kind: 'missing'; readonly key: string }
  | { readonly kind: 'invalid'; readonly key: string; readonly value: string };

/**
 * Read every regime's rule from configuration values keyed
 * `iva.<regime>.rate` and `iva.<regime>.basis`. A missing or malformed value
 * is a problem, never a default: a rate the fleet guessed is a wrong invoice.
 */
export const taxRulesFrom = (
  read: (key: string) => string | undefined,
):
  | { readonly ok: true; readonly rules: TaxRules }
  | { readonly ok: false; readonly problem: TaxRulesProblem } => {
  const rules: Partial<Record<TaxRegime, TaxRule>> = {};
  for (const regime of TaxRegimes) {
    const rateKey = `iva.${regime}.rate`;
    const basisKey = `iva.${regime}.basis`;
    const rate = read(rateKey);
    const basis = read(basisKey);
    if (rate === undefined)
      return { ok: false, problem: { kind: 'missing', key: rateKey } };
    if (basis === undefined)
      return { ok: false, problem: { kind: 'missing', key: basisKey } };
    const rateBasisPoints = Number(rate);
    if (
      rate.trim() === '' ||
      !Number.isInteger(rateBasisPoints) ||
      rateBasisPoints < 0 ||
      rateBasisPoints > 10_000
    )
      return {
        ok: false,
        problem: { kind: 'invalid', key: rateKey, value: rate },
      };
    if (!isTaxBasis(basis))
      return {
        ok: false,
        problem: { kind: 'invalid', key: basisKey, value: basis },
      };
    rules[regime] = { rateBasisPoints, basis };
  }
  return { ok: true, rules: rules as TaxRules };
};

/** The rule for a regime value read off a record; `undefined` when unknown. */
export const taxRuleOf = (
  rules: TaxRules,
  regime: unknown,
): TaxRule | undefined => (isTaxRegime(regime) ? rules[regime] : undefined);
