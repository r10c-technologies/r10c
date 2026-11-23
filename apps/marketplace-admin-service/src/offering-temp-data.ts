import {
  DEMO_VENDOR,
  seededSaleTermsOf,
  type SeededVendor,
} from '@r10c/utils-ts-fleet';

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
}

export interface ProductOfferingPriceRecord {
  id: string;
  offeringId: string;
  amount: number;
  currency: string;
  /** How many whole units `amount` buys: 1, or 100 for the one per hundred. */
  pricePer: number;
}

/**
 * One offering per specification, and the statuses are spread on purpose.
 *
 * A seed where everything is `draft` cannot exercise `unpublish` and a seed
 * where everything is `published` cannot exercise the illegal transition, so
 * the four states are cycled: every verb has a record it legitimately applies
 * to and a record it must refuse, without anybody hand-editing a row first.
 */
const STATUSES = ['draft', 'published', 'unpublished', 'pending-review'];

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

/** One seeded vendor's offerings, one per specification, under its prefix. */
export const offeringTempDataFor = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'offerings' | 'measured'>,
): ProductOfferingRecord[] =>
  productTempDataFor(vendor).map((specification, index) => {
    // One by the half metre and one priced per hundred, the rest by the
    // piece: the shared seed terms, so stock counts each in its own unit.
    const { saleUnit, quantityStep, quantityMinimum } = seededSaleTermsOf(
      vendor,
      index,
    );
    return {
      id: `${vendor.idPrefix}product-offering-${index + 1}`,
      name: `${specification.name} — oferta`,
      specificationId: specification.id,
      status: STATUSES[index % STATUSES.length],
      // Without this the seeded `published` offerings carry no moment, the
      // walk reports them `unstamped`, and a fresh lab still serves an empty
      // storefront — which is the whole defect this seed change exists to
      // close.
      statusChangedAt: SEEDED_AT,
      saleUnit,
      quantityStep,
      quantityMinimum,
    };
  });

/** The demo vendor's offerings. */
export const offeringTempData: ProductOfferingRecord[] =
  offeringTempDataFor(DEMO_VENDOR);

/**
 * One price per offering, in **minor units** — `amount` is an integer number of
 * cents, never a float, because a binary float cannot represent 0.10 exactly
 * and money that is off by a rounding error is money a settlement run has to
 * reconcile by hand.
 *
 * Currency is cycled over three so a list sorted or filtered by it has more
 * than one group to show.
 */
const CURRENCIES = ['GTQ', 'USD', 'EUR'];

export const offeringPriceTempDataFor = (
  vendor: Pick<SeededVendor, 'idPrefix' | 'offerings' | 'measured'>,
): ProductOfferingPriceRecord[] =>
  offeringTempDataFor(vendor).map((offering, index) => ({
    id: `${vendor.idPrefix}product-offering-price-${index + 1}`,
    offeringId: offering.id,
    // 19.99, 24.99, 29.99 … in minor units. Never a round number, so a display
    // that drops the fractional part is visible at a glance.
    amount: 1999 + index * 500,
    currency: CURRENCIES[index % CURRENCIES.length],
    pricePer: seededSaleTermsOf(vendor, index).pricePer,
  }));

/** The demo vendor's prices. */
export const offeringPriceTempData: ProductOfferingPriceRecord[] =
  offeringPriceTempDataFor(DEMO_VENDOR);
