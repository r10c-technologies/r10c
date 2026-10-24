import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { describe, expect, it } from 'vitest';

import { jsonLdScript, productJsonLd } from './product-json-ld';

const offering = (fill: (one: PublishedOffering) => void = () => undefined) => {
  const one = new PublishedOffering(
    'offering-1',
    'vendor-1',
    'Cobalto Arc Lamp',
  );
  one.amount = 18900;
  one.currency = 'USD';
  fill(one);
  return one;
};

const URL = 'https://tienda.example/es/p/offering-1';

describe('productJsonLd', () => {
  it('states every member the snapshot carries', () => {
    expect(
      productJsonLd({
        offering: offering(one => {
          one.description = 'A marble foot.';
          one.code = 'ARC-1';
          one.availableHint = true;
          one.media = [
            { url: 'https://img.example/1.jpg', alt: 'Front' },
            { url: 'https://img.example/2.jpg', alt: 'Side' },
          ];
        }),
        url: URL,
        brandName: 'Cobalto',
        sellerName: 'Cobalto Studio',
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Cobalto Arc Lamp',
      description: 'A marble foot.',
      sku: 'ARC-1',
      image: ['https://img.example/1.jpg', 'https://img.example/2.jpg'],
      brand: { '@type': 'Brand', name: 'Cobalto' },
      offers: {
        '@type': 'Offer',
        url: URL,
        price: '189.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Organization', name: 'Cobalto Studio' },
      },
    });
  });

  it('leaves out what the snapshot left out, and says out of stock', () => {
    expect(productJsonLd({ offering: offering(), url: URL })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Cobalto Arc Lamp',
      offers: {
        '@type': 'Offer',
        url: URL,
        price: '189.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/OutOfStock',
      },
    });
  });

  it('treats an empty gallery as no image', () => {
    const ld = productJsonLd({
      offering: offering(one => {
        one.media = [];
      }),
      url: URL,
    });
    expect(ld).not.toHaveProperty('image');
  });
});

describe('jsonLdScript', () => {
  it('cannot close the script tag it is written into', () => {
    const script = jsonLdScript({ name: '</script><script>alert(1)</script>' });

    expect(script).not.toContain('<');
    expect(JSON.parse(script)).toEqual({
      name: '</script><script>alert(1)</script>',
    });
  });
});
