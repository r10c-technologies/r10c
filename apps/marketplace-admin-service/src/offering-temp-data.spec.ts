import { describe, expect, it } from 'vitest';

import { offeringPriceTempData, offeringTempData } from './offering-temp-data';

describe('offeringTempData', () => {
  /**
   * ⚠️ The seed is the reason #215 exists.
   *
   * Offerings are written straight into tenant Mongo, so a stored `published`
   * one has run no transition and announced nothing. The rebuild walk is what
   * announces them — and it can only do that for an offering carrying the moment
   * its status was decided, so a seed that omits one leaves a fresh lab serving
   * an empty storefront exactly as before.
   */
  it('stamps every seeded offering with the moment its status was decided', () => {
    expect(
      offeringTempData.every(
        offering => offering.statusChangedAt instanceof Date,
      ),
    ).toBe(true);
  });

  it('uses one fixed moment, so a reset is reproducible', () => {
    // The announcement's id is `<offeringId>:<publishedAt>`. A moment read from
    // the clock at module load would give every boot different event ids and
    // make each restart look like a fresh publication.
    const moments = new Set(
      offeringTempData.map(offering => offering.statusChangedAt.toISOString()),
    );

    expect(moments.size).toBe(1);
  });

  it('seeds offerings the walk can actually announce', () => {
    // Publishing needs a price and a specification, so a seeded `published`
    // offering missing either is reported unannounceable rather than projected.
    const priced = new Set(
      offeringPriceTempData.map(price => price.offeringId),
    );

    expect(
      offeringTempData
        .filter(offering => offering.status === 'published')
        .every(offering => priced.has(offering.id)),
    ).toBe(true);
  });

  // One sold by the metre and one priced per hundred reach the storefront, so
  // a reset lab shows both cases ADR 0082 adds without anybody editing a row.
  it('publishes one offering by the half metre and one priced per hundred', () => {
    const metre = offeringTempData.find(
      offering => offering.id === 'product-offering-10',
    );
    const perHundred = offeringPriceTempData.find(
      price => price.offeringId === 'product-offering-22',
    );

    expect(metre).toMatchObject({
      status: 'published',
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
    });
    expect(perHundred).toMatchObject({ pricePer: 100, currency: 'GTQ' });
    expect(
      offeringTempData.find(offering => offering.id === 'product-offering-22')
        ?.status,
    ).toBe('published');
  });
});
