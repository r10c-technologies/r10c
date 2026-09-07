import { productTempData } from './product-temp-data';

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
}

export interface ProductOfferingPriceRecord {
  id: string;
  offeringId: string;
  amount: number;
  currency: string;
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

export const offeringTempData: ProductOfferingRecord[] = productTempData.map(
  (specification, index) => ({
    id: `product-offering-${index + 1}`,
    name: `${specification.name} — oferta`,
    specificationId: specification.id,
    status: STATUSES[index % STATUSES.length],
  }),
);

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

export const offeringPriceTempData: ProductOfferingPriceRecord[] =
  offeringTempData.map((offering, index) => ({
    id: `product-offering-price-${index + 1}`,
    offeringId: offering.id,
    // 19.99, 24.99, 29.99 … in minor units. Never a round number, so a display
    // that drops the fractional part is visible at a glance.
    amount: 1999 + index * 500,
    currency: CURRENCIES[index % CURRENCIES.length],
  }));
