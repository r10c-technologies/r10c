import { accessor, type Entity, entity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  permissionForStockSurface,
  RESERVATION_SURFACE,
  STOCK_ITEM_SURFACE,
  STOCK_MOVEMENT_SURFACE,
  STOCK_SURFACES,
  stockListAddress,
  stockRecordAddress,
  stockSurface,
} from './stock-surfaces';

describe('the stock surfaces', () => {
  it('declares the three the back office serves, in nav order', () => {
    expect(STOCK_SURFACES.map(surface => surface.entityKey)).toEqual([
      'stock-item',
      'stock-movement',
      'reservation',
    ]);
  });

  it('reads each entity’s plural from its own decorator', () => {
    // Not rebuilt from the key: a second place that knows how an entity's
    // catalog subtree is laid out is a second place to fix when one moves.
    expect(STOCK_ITEM_SURFACE.entityPluralKey).toBe('entity:stock-item.plural');
    expect(STOCK_MOVEMENT_SURFACE.entityPluralKey).toBe(
      'entity:stock-movement.plural',
    );
    expect(RESERVATION_SURFACE.entityPluralKey).toBe(
      'entity:reservation.plural',
    );
  });

  it('routes each surface at its own entity key', () => {
    // Unlike the catalog, where `product-specification` lives at
    // `/catalog/product`, nothing in this domain renames itself — so a drift
    // between the two would be gratuitous rather than deliberate.
    expect(STOCK_ITEM_SURFACE.basePath).toBe('/stock/stock-item');
    expect(STOCK_MOVEMENT_SURFACE.basePath).toBe('/stock/stock-movement');
    expect(RESERVATION_SURFACE.basePath).toBe('/stock/reservation');
  });

  /**
   * ⚠️ A label member that is not sortable, filterable **and** a string makes
   * `defineRecordSearchSource` throw at module load, which fails the app at
   * boot rather than one render. Every other member of these three entities is
   * a number or an enum, so `offeringId` is the only one that qualifies — and
   * it only qualifies because it was made `sortable` for this.
   */
  it('names every stock record by the one member of it that can be searched', () => {
    for (const surface of STOCK_SURFACES) {
      expect(surface.searchProperty).toBe('offeringId');
      expect(surface.labelProperty).toBe('offeringId');
    }
  });

  it('carries shell-namespaced nav copy', () => {
    // `app:` keys are a lint error outside `apps/`, and this is a shell.
    for (const surface of STOCK_SURFACES) {
      expect(surface.navLabelKey.startsWith('shell:stock.nav.')).toBe(true);
    }
  });
});

describe('stockSurface', () => {
  it('rejects an entity that declares no plural key', () => {
    // `pluralKey` is optional on `MetaEntityOptions`, and a surface without one
    // titles its search group `undefined` on the first keystroke — a failure
    // that surfaces as "this group is broken" rather than "this is undeclared".
    @entity({ domain: 'stock-management', key: 'stock-item' })
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
      stockSurface(Unnamed, {
        entityKey: 'stock-item',
        basePath: '/stock/stock-item',
        icon: '▤',
        navLabelKey: 'shell:stock.nav.items',
        searchProperty: 'offeringId',
        labelProperty: 'offeringId',
      }),
    ).toThrow(/pluralKey/);
  });
});

describe('permissionForStockSurface', () => {
  it('derives the permission from the entity’s own domain and key', () => {
    // The domain string is written nowhere in this shell: it comes off
    // `@entity({ domain, key })`, which is the whole point of the
    // `<domain>:<entityKey>:<action>` shape — a hand-written one here could
    // name a domain the route behind it does not check.
    expect(permissionForStockSurface(STOCK_ITEM_SURFACE)).toBe(
      'stock-management:stock-item:read',
    );
    expect(permissionForStockSurface(STOCK_MOVEMENT_SURFACE)).toBe(
      'stock-management:stock-movement:read',
    );
    expect(permissionForStockSurface(RESERVATION_SURFACE)).toBe(
      'stock-management:reservation:read',
    );
  });

  it('asks for read, never write', () => {
    // A nav item offering a screen the caller may only look at is correct; one
    // gated on `write` would hide the ledger from everybody who can read it.
    for (const surface of STOCK_SURFACES) {
      expect(permissionForStockSurface(surface).endsWith(':read')).toBe(true);
    }
  });
});

describe('the workspace addresses', () => {
  /**
   * ⚠️ **`operation:`, and that is the point of this whole declaration.** The
   * address is the taxonomy serialized (ADR 0042), so a stock screen addressed
   * `master:` would be a lie the registry then had to keep — and it would have
   * been the easy mistake, because `master:` was the only entity kind any
   * workspace could resolve until this shell landed.
   */
  it('addresses a list under the operation type', () => {
    expect(stockListAddress(STOCK_ITEM_SURFACE)).toBe('operation:stock-item');
    expect(stockListAddress(STOCK_MOVEMENT_SURFACE)).toBe(
      'operation:stock-movement',
    );
    expect(stockListAddress(RESERVATION_SURFACE)).toBe('operation:reservation');
  });

  it('addresses a record by appending its id', () => {
    expect(stockRecordAddress(STOCK_ITEM_SURFACE, 'stock-item-1')).toBe(
      'operation:stock-item:stock-item-1',
    );
  });

  it('never emits a master address', () => {
    for (const surface of STOCK_SURFACES) {
      expect(stockListAddress(surface).startsWith('operation:')).toBe(true);
      expect(stockRecordAddress(surface, 'x').startsWith('operation:')).toBe(
        true,
      );
    }
  });
});
