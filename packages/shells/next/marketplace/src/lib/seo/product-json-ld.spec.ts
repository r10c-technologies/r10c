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

  it('names the vendor’s own SKU over the product model’s code', () => {
    expect(
      productJsonLd({
        offering: offering(one => {
          one.code = 'ARC-1';
          one.sku = 'COB-ARC-NEGRA';
        }),
        url: URL,
      }),
    ).toMatchObject({ sku: 'COB-ARC-NEGRA' });
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

  it('says how much a price for more than one piece buys', () => {
    const ld = productJsonLd({
      offering: offering(one => {
        one.amount = 750;
        one.saleUnit = 'UN';
        one.pricePer = 100;
      }),
      url: URL,
    });

    expect(ld['offers']).toMatchObject({
      price: '7.50',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '7.50',
        priceCurrency: 'USD',
        referenceQuantity: {
          '@type': 'QuantitativeValue',
          value: 100,
          unitCode: 'H87',
        },
      },
    });
  });

  it('states a sample picture served by the storefront as an absolute URL', () => {
    const ld = productJsonLd({
      offering: offering(one => {
        one.media = [{ url: '/samples/store/item.svg', alt: 'Item' }];
      }),
      url: URL,
    });
    expect(ld['image']).toEqual([
      'https://tienda.example/samples/store/item.svg',
    ]);
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
