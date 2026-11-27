import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { KitStockRow } from '@r10c/business-ts-sales-vocabulary';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ShippingOrder } from '../entities/shipping-order/index.js';
import { ShippingLine } from './shipping-line.js';

describe('ShippingLine', () => {
  // A packer reads 3.5 m, never 3500: the unit travels with the line from
  // the order to the shipment and is stored with it (ADR 0082 §2).
  it('keeps the unit its quantity is counted in through a store’s round trip', () => {
    const line = Object.assign(new ShippingLine('cable', 'Cable', 3500), {
      unit: 'M' as const,
    });
    const order = Object.assign(new ShippingOrder(), { lines: [line] });

    const stored = Effect.runSync(
      deserializeSingleEntity(
        ShippingOrder,
        serializeEntity(ShippingOrder, order),
      ),
    ) as ShippingOrder;

    expect(stored.lines[0]).toMatchObject({
      offeringId: 'cable',
      unit: 'M',
      quantity: 3500,
    });
  });

  it('states no unit it was not given', () => {
    expect(new ShippingLine('gear', 'Engranaje', 2).unit).toBeUndefined();
  });

  it('describes a kit’s components as rows a packer reads', () => {
    const kit = describeEntityColumns(ShippingLine).find(
      column => column.name === 'kitComponents',
    );

    expect(kit?.childType).toBe(KitStockRow);
  });
});

