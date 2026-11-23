import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PublishedVendor } from './published-vendor.entity.js';

describe('PublishedVendor', () => {
  it('serializes the name the storefront renders', () => {
    const vendor = new PublishedVendor('demo-organization', 'Demo Vendor');
    vendor.id = 'demo-organization';
    vendor.announcedAt = new Date('2026-10-23T10:00:00.000Z');

    expect(serializeEntity(PublishedVendor, vendor)).toEqual({
      id: 'demo-organization',
      vendorId: 'demo-organization',
      displayName: 'Demo Vendor',
      announcedAt: new Date('2026-10-23T10:00:00.000Z'),
      acceptsCod: false,
      holdsStock: false,
      acceptsLink: false,
      whatsappNumber: '',
      sampleStore: false,
      taxId: '',
      legalName: '',
      taxRegime: '',
      establishmentCode: '',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const vendor = await Effect.runPromise(
      deserializeSingleEntity(PublishedVendor, {
        id: 'org-2',
        vendorId: 'org-2',
        displayName: 'Terra Studio',
        announcedAt: new Date('2026-10-23T11:00:00.000Z'),
        acceptsCod: true,
        holdsStock: true,
        acceptsLink: true,
        whatsappNumber: '+50255551234',
        sampleStore: true,
        taxId: '20000006',
        legalName: 'Terra Studio',
        taxRegime: 'small-taxpayer',
        establishmentCode: '2',
      }),
    );

    expect(vendor?.vendorId).toBe('org-2');
    expect(vendor?.displayName).toBe('Terra Studio');
    expect(vendor?.whatsappNumber).toBe('+50255551234');
    expect(vendor?.sampleStore).toBe(true);
    expect(vendor?.announcedAt.toISOString()).toBe('2026-10-23T11:00:00.000Z');
    expect(vendor?.acceptsCod).toBe(true);
    expect(vendor?.holdsStock).toBe(true);
    expect(vendor?.acceptsLink).toBe(true);
    expect([
      vendor?.taxId,
      vendor?.legalName,
      vendor?.taxRegime,
      vendor?.establishmentCode,
    ]).toEqual(['20000006', 'Terra Studio', 'small-taxpayer', '2']);
  });

  it('defaults to the epoch, so an unstamped record loses every comparison', () => {
    const vendor = new PublishedVendor();

    expect([vendor.vendorId, vendor.displayName]).toEqual(['', '']);
    expect(vendor.announcedAt.getTime()).toBe(0);

    vendor.vendorId = 'org-3';
    vendor.displayName = 'Nimbus';
    expect([vendor.vendorId, vendor.displayName]).toEqual(['org-3', 'Nimbus']);
  });

  it('lets the storefront ask for a page of sellers by id', () => {
    const columns = new Map(
      describeEntityColumns(PublishedVendor).map(column => [
        column.name,
        column,
      ]),
    );

    expect(columns.get('vendorId')?.filterable).toBe(true);
    expect(columns.get('displayName')?.sortable).toBe(true);
  });
});
