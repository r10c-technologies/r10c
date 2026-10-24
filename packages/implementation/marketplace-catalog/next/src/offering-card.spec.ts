import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { formatPrice } from '@r10c/utils-react-ui';
import { describe, expect, it } from 'vitest';

import { offeringCard, type OfferingCardContext } from './offering-card.js';

const context: OfferingCardContext = {
  locale: 'es',
  brandName: id => (id === 'brand-1' ? 'Aurora' : undefined),
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
      price: formatPrice('es', 45000, 'GTQ'),
      brand: 'Aurora',
      description: 'Luz cálida',
      // The first picture only: the rest belong to the product page.
      media: { url: 'https://img.example/1.jpg', alt: 'De frente' },
      availability: 'Disponible',
    });
  });

  it('leaves a role absent when the snapshot left its member absent', () => {
    const card = offeringCard(offering(), context);

    expect(card.brand).toBeUndefined();
    expect(card.description).toBeUndefined();
    expect(card.media).toBeUndefined();
    expect(card.availability).toBe('Agotado');
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
});
