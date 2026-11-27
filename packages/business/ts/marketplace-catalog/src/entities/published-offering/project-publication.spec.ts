import type { CatalogPublication } from '@r10c/business-ts-catalog-contracts';
import { describe, expect, it } from 'vitest';

import { projectPublication } from './project-publication.js';

const PUBLICATION: CatalogPublication = {
  offeringId: 'o-1',
  vendorId: 'v-1',
  name: 'Tornillo',
  amount: 750,
  currency: 'GTQ',
  availableHint: true,
  publishedAt: '2026-11-22T10:00:00.000Z',
  specificationId: 's-1',
  specificationVersion: 2,
  saleUnit: 'UN',
  quantityStep: 50,
  quantityMinimum: 100,
  pricePer: 100,
  code: 'T-4',
  description: 'Cabeza plana.',
  brandId: 'b-1',
  categoryId: 'c-1',
  media: [{ url: 'https://cdn.example/t.jpg', alt: 'Un tornillo' }],
  fitsDeviceModelIds: ['universal'],
};

describe('projectPublication', () => {
  const AT = new Date('2026-11-22T10:00:01.000Z');

  it('copies the snapshot onto the record, keyed on the offering', () => {
    const { publishedAt: _, ...copied } = PUBLICATION;

    expect(projectPublication(PUBLICATION, AT)).toMatchObject({
      ...copied,
      id: 'o-1',
      publishedAt: AT,
    });
  });

  it('copies a presentation’s base, factor and the base’s unit', () => {
    const stock = {
      stockOfferingId: 'o-base',
      stockFactor: 100_000,
      stockUnit: 'M',
    } as const;

    expect(projectPublication({ ...PUBLICATION, ...stock }, AT)).toMatchObject(
      stock,
    );
  });

  it('derives the key a list orders prices quoted per hundred by', () => {
    // Q7.50 the hundred is Q75.00 the thousand: it ranks below Q0.10 each.
    expect(projectPublication(PUBLICATION, AT).amountPerThousand).toBe(7500);
    expect(
      projectPublication({ ...PUBLICATION, amount: 10, pricePer: 1 }, AT)
        .amountPerThousand,
    ).toBe(10_000);
  });

  it('groups a variant by its series, and derives the words it is searched by', () => {
    const projected = projectPublication(
      {
        ...PUBLICATION,
        sku: 'FUN-A15-NEGRA',
        code: 'product-9',
        description: 'Suave y resistente.',
        specKey: 'funda-a15',
        variantValues: [{ axis: 'color', value: 'negro' }],
      },
      AT,
    );

    expect(projected.variantGroup).toBe('funda-a15');
    expect(projected.specKey).toBe('funda-a15');
    expect(projected.variantValues).toEqual([
      { axis: 'color', value: 'negro' },
    ]);
    expect(projected.sku).toBe('FUN-A15-NEGRA');
    expect(projected.searchText).toBe(
      `${PUBLICATION.name} FUN-A15-NEGRA product-9 negro Suave y resistente.`,
    );
  });

  it('puts an offering that is no variant in no group', () => {
    const projected = projectPublication(
      { ...PUBLICATION, specKey: 'funda-a15' },
      AT,
    );

    expect(projected.variantGroup).toBeUndefined();
    expect(projected.searchText).toBe(
      [PUBLICATION.name, PUBLICATION.code, PUBLICATION.description].join(' '),
    );
  });

  it('carries a kit’s components and their count, and none on another offering', () => {
    const kitComponents = [
      {
        offeringId: 'case',
        quantity: 1,
        stockOfferingId: 'case',
        stockUnit: 'UN' as const,
        stockQuantity: 1,
      },
    ];

    const kit = projectPublication({ ...PUBLICATION, kitComponents }, AT);
    const plain = projectPublication(PUBLICATION, AT);

    expect([kit.kitComponents, kit.kitSize]).toEqual([kitComponents, 1]);
    expect([plain.kitComponents, plain.kitSize]).toEqual([
      undefined,
      undefined,
    ]);
  });
});
