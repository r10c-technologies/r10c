import type { SeededVendor } from '@r10c/utils-ts-fleet';

import { productTempDataFor } from './product-temp-data';

/**
 * Seed offerings and their prices, generated **from** the specifications this
 * service already seeds rather than from a parallel list.
 *
 * `specificationId` and `offeringId` are plain ids, the same convention
 * `product-temp-data.ts` uses for brand and category: same store here, so a
 * typed link would be legal, but nothing in this domain declares one and a
 * dangling id is a display gap rather than a corrupt record. Deriving them from
 * `productTempData` is what keeps the two seeds from drifting — a specification
 * renamed or removed takes its offering with it, with no second list to
 * remember.
 *
 * Not a production source.
 */
export interface ProductOfferingRecord {
  id: string;
  name: string;
  specificationId: string;
  status: string;
  statusChangedAt: Date;
  /** How it is sold (ADR 0082), stated on every row rather than defaulted. */
  saleUnit: string;
  quantityStep: number;
  quantityMinimum: number;
  /**
   * A presentation's base and what one takes of it (ADR 0082 §7); absent,
   * never `undefined`, on an offering that draws on no base.
   */
  stockOfferingId?: string;
  stockFactor?: number;
}

export interface ProductOfferingPriceRecord {
  id: string;
  offeringId: string;
  amount: number;
  currency: string;
  /** How many whole units `amount` buys: 1, or 100 for the one per hundred. */
  pricePer: number;
  /** Where the price steps down by quantity; absent, never `[]`, when none. */
  tiers?: { from: number; amount: number }[];
}

/**
 * One offering per specification, and the statuses are spread on purpose.
 *
 * A seed where everything is `draft` cannot exercise `unpublish` and a seed
 * where everything is `published` cannot exercise the illegal transition, so
 * every sample store holds all four states: every verb has a record it
 * legitimately applies to and a record it must refuse, without anybody
 * hand-editing a row first (`sample-stores.spec.ts` checks it).
 */
/**
 * When the seed decided every offering's status.
 *
 * ⚠️ **A fixed constant, never `new Date()`.** The rebuild walk re-announces a
 * published offering with the moment stored on it, and the announcement's id is
 * `<offeringId>:<publishedAt>` — so a moment that moved with each boot would
 * make every reset produce different event ids and every restart look like a
 * fresh publication. A constant makes a seeded lab reproducible, which is what
 * lets a test name one.
 *
 * It is in the past on purpose: any real transition a vendor makes later carries
 * a newer moment and therefore wins against it.
 */
const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z');

const offeringIdOf = (
  vendor: Pick<SeededVendor, 'idPrefix'>,
  index: number,
): string => `${vendor.idPrefix}product-offering-${String(index + 1)}`;

/**
 * The stock source a presentation is seeded with: its base's positional id,
 * found by the base's key in the same store (ADR 0082 §7). A key that names
 * no product throws, because a seed drawing on nothing is a broken seed.
 */
const stockSourceOf = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'products'>,
  drawsOn: { readonly key: string; readonly factor: number } | undefined,
): Pick<ProductOfferingRecord, 'stockOfferingId' | 'stockFactor'> => {
  if (drawsOn === undefined) return {};
  const base = vendor.products.findIndex(one => one.key === drawsOn.key);
  if (base < 0) throw new Error(`no product ${drawsOn.key} to draw on`);
  return {
    stockOfferingId: offeringIdOf(vendor, base),
    stockFactor: drawsOn.factor,
  };
};

/** One seeded store's offerings, one per specification, under its prefix. */
export const offeringTempDataFor = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'products' | 'slug'>,
): ProductOfferingRecord[] =>
  productTempDataFor(vendor).map((specification, index) => {
    const product = vendor.products[index];
    return {
      id: offeringIdOf(vendor, index),
      // The product's own name: a store sells "Cable THHN #12", not an
      // "offer" of it.
      name: specification.name,
      specificationId: specification.id,
      status: product.status,
      // Without this the seeded `published` offerings carry no moment, the
      // walk reports them `unstamped`, and a fresh lab still serves an empty
      // storefront.
      statusChangedAt: SEEDED_AT,
      saleUnit: product.unit,
      quantityStep: product.step,
      quantityMinimum: product.minimum,
      ...stockSourceOf(vendor, product.drawsOn),
    };
  });

/**
 * One price per offering, in **minor units** — `amount` is an integer number of
 * cents, never a float, because a binary float cannot represent 0.10 exactly
 * and money that is off by a rounding error is money a settlement run has to
 * reconcile by hand.
 *
 * Every sample price is in quetzales and **illustrative**: near what the
 * research found a Guatemalan store asking, never a quote anybody gave. The
 * stores are flagged `sampleStore`, and the storefront says so.
 */
export const offeringPriceTempDataFor = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'products' | 'slug'>,
): ProductOfferingPriceRecord[] =>
  vendor.products.map((product, index) => ({
    id: `${vendor.idPrefix}product-offering-price-${index + 1}`,
    offeringId: `${vendor.idPrefix}product-offering-${index + 1}`,
    amount: product.amount,
    currency: 'GTQ',
    pricePer: product.pricePer,
    ...(product.tiers === undefined
      ? {}
      : { tiers: product.tiers.map(tier => ({ ...tier })) }),
  }));
