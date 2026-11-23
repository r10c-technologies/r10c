import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { describe, expect, it } from 'vitest';

import { offeringCard, type OfferingCardContext } from './offering-card.js';

const context: OfferingCardContext = {
  locale: 'es',
  brandName: id => (id === 'brand-1' ? 'Aurora' : undefined),
  sellerName: id => (id === 'vendor-1' ? 'Casa Solano' : undefined),
  priceBasis: one =>
    one.pricePer === 1 ? undefined : `por ${String(one.pricePer)} u.`,
  soldBy: seller => `Vendido por ${seller}`,
  labels: { available: 'Disponible', unavailable: 'Agotado' },
};

const offering = (fill: (one: PublishedOffering) => void = () => undefined) => {
  const one = new PublishedOffering('offering-1', 'vendor-1', 'Lámpara Arco');
  one.amount = 45000;
  one.currency = 'GTQ';
  fill(one);
  return one;
};

describe('offeringCard', () => {
  it('fills every role a full snapshot carries', () => {
    const card = offeringCard(
      offering(one => {
        one.brandId = 'brand-1';
        one.description = 'Luz cálida';
        one.availableHint = true;
        one.media = [
          { url: 'https://img.example/1.jpg', alt: 'De frente' },
          { url: 'https://img.example/2.jpg', alt: 'De lado' },
        ];
      }),
      context,
    );

    expect(card).toEqual({
      title: 'Lámpara Arco',
      price: { amount: 45000, currency: 'GTQ', locale: 'es' },
      unitPrice: undefined,
      brand: 'Aurora',
      seller: 'Vendido por Casa Solano',
      description: 'Luz cálida',
      // The first picture only: the rest belong to the product page.
      media: { url: 'https://img.example/1.jpg', alt: 'De frente' },
      availability: { label: 'Disponible', available: true },
    });
  });

  it('leaves a role absent when the snapshot left its member absent', () => {
    const card = offeringCard(offering(), context);

    expect(card.brand).toBeUndefined();
    expect(card.description).toBeUndefined();
    expect(card.media).toBeUndefined();
    expect(card.availability).toEqual({ label: 'Agotado', available: false });
  });

  it('says what the price buys beside it', () => {
    const card = offeringCard(
      offering(one => {
        one.amount = 750;
        one.pricePer = 100;
      }),
      context,
    );

    expect(card.unitPrice).toBe('por 100 u.');
  });

  it('leaves the brand absent when the vocabulary does not know it', () => {
    const card = offeringCard(
      offering(one => {
        one.brandId = 'brand-retired';
      }),
      context,
    );

    expect(card.brand).toBeUndefined();
  });

  it('names the seller through the projection, and draws no line for one it does not know', () => {
    // Two vendors can sell the same product under the same name; the seller
    // line is what tells their cards apart (#567).
    expect(offeringCard(offering(), context).seller).toBe(
      'Vendido por Casa Solano',
    );

    const unknown = new PublishedOffering('offering-2', 'vendor-404', 'Arco');
    unknown.currency = 'GTQ';

    // An absent line is honest; a raw vendor id is not (ADR 0061).
    expect(offeringCard(unknown, context).seller).toBeUndefined();
  });
});
