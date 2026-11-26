import { describeEntityColumns } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { KitComponentRow, KitStockRow } from './kit-component-row.js';

describe('KitComponentRow', () => {
  it('holds a component and a count, one until set', () => {
    const row = new KitComponentRow();
    expect([row.offeringId, row.quantity]).toEqual(['', 1]);

    row.offeringId = 'case';
    row.quantity = 2;

    expect([row.offeringId, row.quantity]).toEqual(['case', 2]);
  });

  it('names its component as a reference a screen reads the name of', () => {
    const [offering] = describeEntityColumns(KitComponentRow);

    expect(offering?.references).toEqual({
      entity: 'product-configuration-management:product-offering',
    });
  });
});

describe('KitStockRow', () => {
  it('adds what one kit takes from stock, from itself in units until set', () => {
    const row = new KitStockRow('case', 2);
    expect([row.stockOfferingId, row.stockUnit, row.stockQuantity]).toEqual([
      '',
      'UN',
      1,
    ]);

    row.offeringId = 'roll';
    row.quantity = 2;
    row.stockOfferingId = 'cable';
    row.stockUnit = 'M';
    row.stockQuantity = 200_000;

    expect([
      row.offeringId,
      row.quantity,
      row.stockOfferingId,
      row.stockUnit,
      row.stockQuantity,
    ]).toEqual(['roll', 2, 'cable', 'M', 200_000]);
    expect(
      describeEntityColumns(KitStockRow).map(column => column.name),
    ).toEqual([
      'offeringId',
      'quantity',
      'stockOfferingId',
      'stockUnit',
      'stockQuantity',
    ]);
  });
});
