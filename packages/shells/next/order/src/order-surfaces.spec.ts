import { accessor, type Entity, entity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  ORDER_SURFACES,
  orderListAddress,
  orderRecordAddress,
  orderSurface,
  permissionForOrderSurface,
  PRODUCT_ORDER_SURFACE,
} from './order-surfaces';

describe('the order surfaces', () => {
  /**
   * One, and that is the shape rather than an omission: an order's **lines** are
   * a `composition`, so they are columns of a detail grid inside this screen and
   * never a surface of their own. `OrderItem` carries no `@entity()` and has no
   * key to address (ADR 0034).
   */
  it('declares the one the back office serves', () => {
    expect(ORDER_SURFACES.map(surface => surface.entityKey)).toEqual([
      'product-order',
    ]);
  });

  it('reads the plural from the entity’s own decorator', () => {
    // Not rebuilt from the key: a second place that knows how an entity's
    // catalog subtree is laid out is a second place to fix when one moves.
    expect(PRODUCT_ORDER_SURFACE.entityPluralKey).toBe(
      'entity:product-order.plural',
    );
  });

  it('routes the surface at its own entity key', () => {
    expect(PRODUCT_ORDER_SURFACE.basePath).toBe('/order/product-order');
  });

  /**
   * ⚠️ A label member that is not sortable, filterable **and** a string makes
   * `defineRecordSearchSource` throw at module load, which fails the app at boot
   * rather than one render. `status` is an enum and `placedAt` a date, so
   * `buyerId` is the only member of `ProductOrder` that qualifies.
   */
  it('names an order by the one member of it that can be searched', () => {
    expect(PRODUCT_ORDER_SURFACE.searchProperty).toBe('buyerId');
    expect(PRODUCT_ORDER_SURFACE.labelProperty).toBe('buyerId');
  });

  it('carries shell-namespaced nav copy', () => {
    // `app:` keys are a lint error outside `apps/`, and this is a shell.
    for (const surface of ORDER_SURFACES) {
      expect(surface.navLabelKey.startsWith('shell:order.nav.')).toBe(true);
    }
  });
});

describe('orderSurface', () => {
  it('rejects an entity that declares no plural key', () => {
    // `pluralKey` is optional on `MetaEntityOptions`, and a surface without one
    // titles its search group `undefined` on the first keystroke — a failure
    // that surfaces as "this group is broken" rather than "this is undeclared".
    @entity({ domain: 'order-management', key: 'product-order' })
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
      orderSurface(Unnamed, {
        entityKey: 'product-order',
        basePath: '/order/product-order',
        icon: '🧾',
        navLabelKey: 'shell:order.nav.orders',
        searchProperty: 'buyerId',
        labelProperty: 'buyerId',
      }),
    ).toThrow(/pluralKey/);
  });
});

describe('permissionForOrderSurface', () => {
  it('derives the permission from the entity’s own domain and key', () => {
    // The domain string is written nowhere in this shell: it comes off
    // `@entity({ domain, key })`, which is the whole point of the
    // `<domain>:<entityKey>:<action>` shape — a hand-written one here could name
    // a domain the route behind it does not check.
    expect(permissionForOrderSurface(PRODUCT_ORDER_SURFACE)).toBe(
      'order-management:product-order:read',
    );
  });

  /**
   * ⚠️ Read, and read is all there is. No role holds `product-order:write` —
   * the write takes a crossing token and no session — so a nav item gated on
   * `write` would hide the screen from everybody (ADR 0052).
   */
  it('asks for read, never write', () => {
    for (const surface of ORDER_SURFACES) {
      expect(permissionForOrderSurface(surface).endsWith(':read')).toBe(true);
    }
  });
});

describe('the workspace addresses', () => {
  it('addresses a list under the operation type', () => {
    // Operaciones: a *process* made every record here — the checkout saga wrote
    // every order, and no person can write one (ADR 0033).
    expect(orderListAddress(PRODUCT_ORDER_SURFACE)).toBe(
      'operation:product-order',
    );
  });

  it('addresses a record by appending its id', () => {
    expect(orderRecordAddress(PRODUCT_ORDER_SURFACE, 'ord-1')).toBe(
      'operation:product-order:ord-1',
    );
  });
});
