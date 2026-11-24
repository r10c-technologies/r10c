import {
  priceTiersRefusal,
  SaleUnits,
} from '@r10c/business-ts-sales-vocabulary';
import { SEEDED_VENDORS } from '@r10c/utils-ts-fleet';
import { describe, expect, it } from 'vitest';

import {
  offeringPriceTempDataFor,
  offeringTempDataFor,
} from './offering-temp-data';
import { productTempDataFor } from './product-temp-data';

const offerings = SEEDED_VENDORS.flatMap(offeringTempDataFor);
const prices = SEEDED_VENDORS.flatMap(offeringPriceTempDataFor);
const specifications = SEEDED_VENDORS.flatMap(productTempDataFor);

describe('the seeded catalog', () => {
  /**
   * ⚠️ The seed is the reason #215 exists.
   *
   * Offerings are written straight into tenant Mongo, so a stored `published`
   * one has run no transition and announced nothing. The rebuild walk is what
   * announces them — and it can only do that for an offering carrying the moment
   * its status was decided, so a seed that omits one leaves a fresh lab serving
   * an empty storefront exactly as before.
   */
  it('stamps every seeded offering with one fixed moment', () => {
    // The announcement's id is `<offeringId>:<publishedAt>`. A moment read from
    // the clock at module load would give every boot different event ids and
    // make each restart look like a fresh publication.
    const moments = new Set(
      offerings.map(offering => offering.statusChangedAt.toISOString()),
    );

    expect(moments.size).toBe(1);
  });

  it('prices every offering once, in quetzales', () => {
    expect(prices.map(price => price.offeringId)).toEqual(
      offerings.map(offering => offering.id),
    );
    expect(new Set(prices.map(price => price.currency))).toEqual(
      new Set(['GTQ']),
    );
  });

  it('keeps every id unique across stores', () => {
    // One published catalog keyed by offering id.
    for (const ids of [
      offerings.map(offering => offering.id),
      prices.map(price => price.id),
      specifications.map(specification => specification.id),
    ]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('seeds tiers only where they step a price down, and at least one store has some', () => {
    const tiered = prices.filter(price => price.tiers !== undefined);
    expect(tiered.length).toBeGreaterThan(0);
    for (const price of tiered) {
      const offering = offerings.find(one => one.id === price.offeringId);
      expect(
        priceTiersRefusal(
          price.tiers ?? [],
          { amount: price.amount, pricePer: price.pricePer as 1 | 100 },
          {
            saleUnit: offering?.saleUnit as 'UN',
            quantityStep: offering?.quantityStep ?? 0,
            quantityMinimum: offering?.quantityMinimum ?? 0,
          },
        ),
      ).toBeUndefined();
    }
  });

  it('seeds each presentation drawing on a base of its own store, one level deep', () => {
    const drawn = offerings.filter(one => one.stockOfferingId !== undefined);
    expect(drawn.length).toBeGreaterThan(0);
    for (const presentation of drawn) {
      const base = offerings.find(
        one => one.id === presentation.stockOfferingId,
      );
      expect(base?.stockOfferingId).toBeUndefined();
      expect(presentation.saleUnit).toBe('UN');
      // Same store: the same id prefix.
      expect(base?.id.replace(/product-offering-\d+$/, '')).toBe(
        presentation.id.replace(/product-offering-\d+$/, ''),
      );
    }
  });

  it('refuses a presentation drawing on a product its store does not hold', () => {
    const [vendor] = SEEDED_VENDORS;
    const broken = {
      ...vendor!,
      products: [
        { ...vendor!.products[0]!, drawsOn: { key: 'nothing', factor: 1 } },
      ],
    };

    expect(() => offeringTempDataFor(broken)).toThrow(/no product nothing/);
  });

  it('sells only in units the vocabulary declares', () => {
    for (const offering of offerings) {
      expect(SaleUnits).toContain(offering.saleUnit);
    }
  });

  it('serves every picture from the platform', () => {
    for (const specification of specifications) {
      expect(specification.media[0]?.url).toMatch(/^\/samples\/[a-z-]+\//);
    }
  });

  it('names what a phone accessory fits, and nothing else', () => {
    const [hardware, phones] = SEEDED_VENDORS;
    expect(
      productTempDataFor(phones).every(
        specification => (specification.fitsDeviceModelIds?.length ?? 0) > 0,
      ),
    ).toBe(true);
    expect(
      productTempDataFor(hardware).some(
        specification => 'fitsDeviceModelIds' in specification,
      ),
    ).toBe(false);
  });
});
