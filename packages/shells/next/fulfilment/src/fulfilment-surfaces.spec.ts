import { accessor, type Entity, entity } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  FULFILMENT_SURFACES,
  fulfilmentListAddress,
  fulfilmentRecordAddress,
  fulfilmentSurface,
  permissionForFulfilmentSurface,
  SHIPPING_ORDER_SURFACE,
  SHIPPING_ORDER_WORKLIST,
} from './fulfilment-surfaces';

describe('the fulfilment surfaces', () => {
  // A shipment's lines are a `composition`, columns of a grid inside this
  // screen and never a surface of their own (ADR 0034).
  it('declares the one the back office serves', () => {
    expect(FULFILMENT_SURFACES.map(surface => surface.entityKey)).toEqual([
      'shipping-order',
    ]);
  });

  it('reads the plural from the entity’s own decorator', () => {
    expect(SHIPPING_ORDER_SURFACE.entityPluralKey).toBe(
      'entity:shipping-order.plural',
    );
  });

  it('routes the surface under the fulfilment domain', () => {
    expect(SHIPPING_ORDER_SURFACE.basePath).toBe('/fulfilment/shipping-order');
  });

  // A search source refuses a label member that is not sortable, filterable
  // and a string, at module load; `orderId` is the one that qualifies.
  it('names a shipment by the order it carries', () => {
    expect(SHIPPING_ORDER_SURFACE.searchProperty).toBe('orderId');
    expect(SHIPPING_ORDER_SURFACE.labelProperty).toBe('orderId');
  });

  it('carries shell-namespaced nav copy', () => {
    for (const surface of FULFILMENT_SURFACES) {
      expect(surface.navLabelKey.startsWith('r10c:fulfilment.nav.')).toBe(true);
    }
  });

  it('opens on the shipments awaiting dispatch', () => {
    expect(SHIPPING_ORDER_WORKLIST).toEqual({
      operator: 'and',
      values: [
        { property: 'status', operator: 'eq', value: 'awaiting-dispatch' },
      ],
    });
  });
});

describe('fulfilmentSurface', () => {
  it('rejects an entity that declares no plural key', () => {
    @entity({ domain: 'shipping-order-management', key: 'shipping-order' })
    class Unnamed implements Entity {
      #id?: string;

      @accessor({ type: 'id', label: 'ID' })
      get id(): string | undefined {
        return this.#id;
      }
      set id(value: string | undefined) {
        this.#id = value;
      }
    }

    expect(() =>
      fulfilmentSurface(Unnamed, {
        entityKey: 'shipping-order',
        basePath: '/fulfilment/shipping-order',
        icon: '📦',
        navLabelKey: 'r10c:fulfilment.nav.shipments',
        searchProperty: 'orderId',
        labelProperty: 'orderId',
      }),
    ).toThrow(/pluralKey/);
  });
});

describe('permissionForFulfilmentSurface', () => {
  // Read, and only read: the verbs carry permissions of their own, and a
  // nav item gated on one of them would hide the screen from a reader.
  it('derives read from the entity’s own domain and key', () => {
    expect(permissionForFulfilmentSurface(SHIPPING_ORDER_SURFACE)).toBe(
      'shipping-order-management:shipping-order:read',
    );
  });
});

describe('the workspace addresses', () => {
  it('addresses a list under the operation type', () => {
    expect(fulfilmentListAddress(SHIPPING_ORDER_SURFACE)).toBe(
      'operation:shipping-order',
    );
  });

  it('addresses a record by appending its id', () => {
    expect(fulfilmentRecordAddress(SHIPPING_ORDER_SURFACE, 'so-1')).toBe(
      'operation:shipping-order:so-1',
    );
  });
});
