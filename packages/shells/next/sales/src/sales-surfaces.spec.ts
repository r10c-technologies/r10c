import { SalesChannel } from '@r10c/business-ts-sales-management';
import { entity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  COUNTER_SALE_SURFACE,
  permissionForSalesSurface,
  SALES_CHANNEL_SURFACE,
  SALES_SURFACES,
  salesListAddress,
  salesRecordAddress,
  salesSurface,
} from './sales-surfaces.js';

describe('the sales surfaces', () => {
  it('declares the channel screen once, for everything that names it', () => {
    expect(SALES_SURFACES).toEqual([SALES_CHANNEL_SURFACE]);
    expect(SALES_CHANNEL_SURFACE.entityKey).toBe('sales-channel');
    expect(SALES_CHANNEL_SURFACE.basePath).toBe('/sales/sales-channel');
  });

  it('reads the plural key off the decorator rather than repeating it', () => {
    expect(SALES_CHANNEL_SURFACE.entityPluralKey).toBe(
      'entity:sales-channel.plural',
    );
  });

  it('derives the permission from the entity, never from a written string', () => {
    expect(permissionForSalesSurface(SALES_CHANNEL_SURFACE)).toBe(
      'sales-management:sales-channel:read',
    );
  });

  it('addresses a channel as Definiciones, because a vendor authored it', () => {
    // ADR 0033's test is who made the record. A channel is defined and then
    // referenced by every order placed through it — the opposite of stock,
    // whose rows a process writes.
    expect(salesListAddress(SALES_CHANNEL_SURFACE)).toBe(
      'master:sales-channel',
    );
    expect(salesRecordAddress(SALES_CHANNEL_SURFACE, 'channel-1')).toBe(
      'master:sales-channel:channel-1',
    );
  });

  it('refuses a surface for an entity that declares no plural key', () => {
    // At module load, where the surface is declared — rather than by titling a
    // search group `undefined` on the first keystroke.
    @entity({ domain: 'sales-management', key: 'sales-channel' })
    class Unnamed extends SalesChannel {}

    expect(() =>
      salesSurface(Unnamed, {
        entityKey: 'sales-channel',
        basePath: '/sales/unnamed',
        icon: '?',
        navLabelKey: 'shell:sales.nav.channels',
        searchProperty: 'name',
        labelProperty: 'name',
      }),
    ).toThrow(/pluralKey/);
  });

  it('keeps the till out of the surface list, because it owns no entity', () => {
    // A surface is an entity's list and record pages. The till is a guided flow
    // over records three other services own, and it writes no `sales` row at
    // all — so it is addressed `wizard:` and declared separately.
    expect(COUNTER_SALE_SURFACE.key).toBe('counter-sale');
    expect(SALES_SURFACES).not.toContainEqual(
      expect.objectContaining({ basePath: COUNTER_SALE_SURFACE.basePath }),
    );
  });
});
