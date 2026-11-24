import { oneWholeUnit, type SaleUnit } from './sale-unit';
import { PRESENTATION_UNIT } from './stock-source';

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

/** What a presentation's line takes from its base's stock is computed from. */
export interface StockTerms {
  readonly quantity: number;
  readonly saleUnit: SaleUnit;
  readonly stockFactor: number;
}

/**
 * How many scaled base quantities a presentation's line draws:
 * `quantity × stockFactor` (ADR 0082 §7). A presentation is sold in `UN`,
 * whose scale is zero, so the quantity is a plain count.
 *
 * ⚠️ **The coordinator calls it once and the line copies the answer.** A
 * cancellation or a return restores what was copied, so a factor edited later
 * corrupts no past order.
 */
export const stockQuantityOf = ({
  quantity,
  saleUnit,
  stockFactor,
}: StockTerms): number => {
  if (saleUnit !== PRESENTATION_UNIT)
    throw new RangeError(
      `a presentation is sold in ${PRESENTATION_UNIT}, not ${saleUnit}`,
    );
  if (stockFactor <= 0)
    throw new RangeError(`${String(stockFactor)} is not a factor`);
  return safe(counted(quantity) * counted(stockFactor));
};
