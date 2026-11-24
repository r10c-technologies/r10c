import { Failure } from '@entifix/core';
import { Schema } from 'effect';

import { lineTotal, type UnitPrice } from './line-total';
import { quantityRefusal } from './sale-line-refusal';
import type { SaleRule } from './sale-rule';

/**
 * One step of a price (ADR 0082 §8): from `from` on — a quantity in the
 * offering's scale — `amount` minor units buy the price's own `pricePer`.
 */
export interface PriceTier {
  readonly from: number;
  readonly amount: number;
}

/** The most tiers one price holds: a table a buyer can read at a glance. */
export const MAX_PRICE_TIERS = 5;

/** A price that may step down by quantity. */
export interface TieredUnitPrice extends UnitPrice {
  readonly tiers?: readonly PriceTier[];
}

/** One tier as a schema, for a payload that carries tiers beside its own. */
export const PriceTierSchema = Schema.Struct({
  from: Schema.Int,
  amount: Schema.Int,
});

/** The members of a tiered price as schema fields: absent when it has none. */
export const PriceTiersFields = {
  tiers: Schema.optional(Schema.Array(PriceTierSchema)),
};

/** What a line is charged at: the tier's amount, and the `from` that gave it. */
export interface ChargedPrice {
  readonly amount: number;
  /** The `from` of the tier that priced the line; absent for the base price. */
  readonly tierFrom?: number;
}

/**
 * The amount `quantity` is charged at (ADR 0082 §8): the tier with the
 * highest `from` not above it prices the **whole line**, or the base price
 * when none does. A larger quantity can therefore cost less than a slightly
 * smaller one, as it does at a counter.
 *
 * ⚠️ **The only place a tier is chosen.** The storefront and the till call it
 * on the published price and send what it answers; the line copies both.
 */
export const tieredPrice = (
  price: TieredUnitPrice,
  quantity: number,
): ChargedPrice => {
  let charged: ChargedPrice = { amount: price.amount };
  for (const tier of price.tiers ?? [])
    if (tier.from <= quantity)
      charged = { amount: tier.amount, tierFrom: tier.from };
  return charged;
};

export const PriceTierProblems = [
  'tooMany',
  'quantity',
  'notAscending',
  'notCheaper',
  'belowOneMinorUnit',
] as const;

export type PriceTierProblem = (typeof PriceTierProblems)[number];

/**
 * Tiers that cannot price a sale: one starting at a quantity the offering
 * does not sell or at its minimum (which is the base price), out of order,
 * not cheaper than the one before, or one whose first quantity would be
 * given away. `index` is the tier's position, from zero.
 */
export class PriceTiersInvalid extends Failure.invalid<PriceTiersInvalid>()(
  'PriceTiersInvalid',
  'priceTiersInvalid',
  {
    index: Schema.Int,
    problem: Schema.Literals(PriceTierProblems),
  },
  {
    message: ({ index, problem }) =>
      `price tier ${String(index)} is refused: ${problem}`,
  },
) {}

/**
 * Why `tiers` cannot step down `base` under `rule`, or `undefined` when they
 * can (ADR 0082 §8): each `from` a quantity the rule sells, above the minimum
 * and strictly ascending; each amount strictly below the one before, the base
 * price first, and still at least one minor unit at its own `from`.
 */
export const priceTiersRefusal = (
  tiers: readonly PriceTier[],
  base: UnitPrice,
  rule: SaleRule,
): PriceTiersInvalid | undefined => {
  if (tiers.length > MAX_PRICE_TIERS)
    return new PriceTiersInvalid({
      index: MAX_PRICE_TIERS,
      problem: 'tooMany',
    });
  let from = rule.quantityMinimum;
  let amount = base.amount;
  for (const [index, tier] of tiers.entries()) {
    if (quantityRefusal('', tier.from, rule) !== undefined)
      return new PriceTiersInvalid({ index, problem: 'quantity' });
    if (tier.from <= from)
      return new PriceTiersInvalid({ index, problem: 'notAscending' });
    if (!Number.isSafeInteger(tier.amount) || tier.amount >= amount)
      return new PriceTiersInvalid({ index, problem: 'notCheaper' });
    if (
      tier.amount < 0 ||
      lineTotal({
        amount: tier.amount,
        pricePer: base.pricePer,
        quantity: tier.from,
        saleUnit: rule.saleUnit,
      }) === 0
    )
      return new PriceTiersInvalid({ index, problem: 'belowOneMinorUnit' });
    from = tier.from;
    amount = tier.amount;
  }
  return undefined;
};

/**
 * The tiers a stored or announced record states, or `undefined` when it has
 * none or they are not tier-shaped. Shape only: whether they price a sale is
 * {@link priceTiersRefusal}.
 */
export const priceTiersOf = (
  value: unknown,
): readonly PriceTier[] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const tiers: PriceTier[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const { from, amount } = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(amount))
      return undefined;
    tiers.push({ from: from as number, amount: amount as number });
  }
  return tiers;
};
