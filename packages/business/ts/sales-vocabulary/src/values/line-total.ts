import { oneWholeUnit, type SaleUnit } from './sale-unit';

/** How many whole units a price buys (ADR 0082 §5). */
export const PricePers = [1, 100, 1000] as const;

export type PricePer = (typeof PricePers)[number];

export const DEFAULT_PRICE_PER: PricePer = 1;

export const isPricePer = (value: unknown): value is PricePer =>
  (PricePers as readonly unknown[]).includes(value);

/** A price: `amount` minor units buy `pricePer` whole units. */
export interface UnitPrice {
  readonly amount: number;
  readonly pricePer: PricePer;
}

/** What a line's total is computed from. */
export interface LineTerms extends UnitPrice {
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
}

const safe = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError(`${String(value)} minor units is not a safe integer`);
  return Number(value);
};

const counted = (value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${String(value)} is not a count`);
  return BigInt(value);
};

/**
 * What a line costs:
 * `roundHalfUp(amount × quantity / (pricePer × 10^scale))`, in minor units
 * (ADR 0082 §6).
 *
 * ⚠️ **The only place a price meets a quantity.** The coordinator calls it
 * once at placement and stores the answer; a preview calls it too; everything
 * else sums what was stored. Multiplying anywhere else charges a measured
 * line a thousand times over.
 */
export const lineTotal = ({
  amount,
  pricePer,
  quantity,
  saleUnit,
}: LineTerms): number => {
  const numerator = counted(amount) * counted(quantity);
  const denominator = BigInt(pricePer) * BigInt(oneWholeUnit(saleUnit));
  return safe((2n * numerator + denominator) / (2n * denominator));
};

/**
 * What a thousand whole units cost: the key prices quoted per one, per hundred
 * and per thousand are ordered and filtered by. An integer, because every
 * `pricePer` divides a thousand.
 */
export const amountPerThousand = ({ amount, pricePer }: UnitPrice): number =>
  safe(counted(amount) * (1000n / BigInt(pricePer)));
