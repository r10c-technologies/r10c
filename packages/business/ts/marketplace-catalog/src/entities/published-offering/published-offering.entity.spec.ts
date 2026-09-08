import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { PublishedOffering } from './published-offering.entity.js';

describe('PublishedOffering', () => {
  it('serializes the snapshot the storefront reads', () => {
    const published = new PublishedOffering(
      'off-1',
      'vendor-1',
      'Blue widget, 3-pack',
    );
    published.id = 'pub-1';
    published.amount = 1050;
    published.currency = 'EUR';
    published.availableHint = true;
    published.publishedAt = new Date('2026-09-07T10:00:00.000Z');
    published.code = 'product-013';
    published.description = 'Three widgets, boxed.';
    published.brandId = 'product-brand-3';
    published.categoryId = 'product-category-7';

    expect(serializeEntity(PublishedOffering, published)).toEqual({
      id: 'pub-1',
      offeringId: 'off-1',
      vendorId: 'vendor-1',
      name: 'Blue widget, 3-pack',
      amount: 1050,
      currency: 'EUR',
      availableHint: true,
      publishedAt: new Date('2026-09-07T10:00:00.000Z'),
      code: 'product-013',
      description: 'Three widgets, boxed.',
      brandId: 'product-brand-3',
      categoryId: 'product-category-7',
    });
  });

  it('serializes an absent merchandising member to nothing at all', () => {
    // `serializeEntity` omits `undefined`, which is what keeps a specification
    // with no description out of the projection as an absent key rather than as
    // a `null` the storefront renders as an empty label.
    const published = new PublishedOffering('off-1', 'vendor-1', 'A widget');

    expect(serializeEntity(PublishedOffering, published)).not.toHaveProperty(
      'description',
    );
  });

  it('rebuilds itself from a stored record', async () => {
    const published = await Effect.runPromise(
      deserializeSingleEntity(PublishedOffering, {
        id: 'pub-2',
        offeringId: 'off-2',
        vendorId: 'vendor-2',
        name: 'Red widget',
        amount: 500,
        currency: 'USD',
        availableHint: false,
        publishedAt: new Date('2026-09-07T10:00:00.000Z'),
        code: 'product-014',
        description: 'One widget.',
        brandId: 'product-brand-4',
        categoryId: 'product-category-8',
      }),
    );

    expect(published?.name).toBe('Red widget');
    expect(published?.availableHint).toBe(false);
    expect(published?.code).toBe('product-014');
    expect(published?.description).toBe('One widget.');
    expect(published?.brandId).toBe('product-brand-4');
    expect(published?.categoryId).toBe('product-category-8');
  });

  it('defaults to unavailable, so a half-built projection oversells nothing', () => {
    const published = new PublishedOffering();

    expect(published.offeringId).toBe('');
    expect(published.vendorId).toBe('');
    expect(published.name).toBe('');
    expect(published.amount).toBe(0);
    expect(published.currency).toBe('');
    expect(published.availableHint).toBe(false);
    // The epoch, so a record that predates this member compares as older than
    // every real publication rather than as newer than all of them.
    expect(published.publishedAt.getTime()).toBe(0);
    // Absent rather than empty. Every one of the four is optional because its
    // source is, and `undefined` is what keeps them out of the document.
    expect(published.code).toBeUndefined();
    expect(published.description).toBeUndefined();
    expect(published.brandId).toBeUndefined();
    expect(published.categoryId).toBeUndefined();
  });

  it('accepts the setters the projector writes through', () => {
    const published = new PublishedOffering();
    published.offeringId = 'off-3';
    published.vendorId = 'vendor-3';
    published.name = 'Green widget';
    published.amount = 250;
    published.currency = 'GBP';
    published.availableHint = true;
    published.publishedAt = new Date('2026-09-07T12:00:00.000Z');
    published.code = 'product-015';
    published.description = 'Green, boxed.';
    published.brandId = 'product-brand-5';
    published.categoryId = 'product-category-9';

    expect(published.offeringId).toBe('off-3');
    expect(published.vendorId).toBe('vendor-3');
    expect(published.name).toBe('Green widget');
    expect(published.amount).toBe(250);
    expect(published.currency).toBe('GBP');
    expect(published.availableHint).toBe(true);
    expect(published.publishedAt.toISOString()).toBe(
      '2026-09-07T12:00:00.000Z',
    );
    expect(published.code).toBe('product-015');
    expect(published.description).toBe('Green, boxed.');
    expect(published.brandId).toBe('product-brand-5');
    expect(published.categoryId).toBe('product-category-9');
  });

  it('lets a category route filter, and prose stay out of the allowlist', () => {
    // Member metadata is the server-side RSQL allowlist. `/c/<category>` is a
    // filter on `categoryId`, so losing that flag answers `400` and renders as
    // an empty grid — silent at both ends. `description` is deliberately the
    // other way: an unanchored `like` over prose is a collection scan no index
    // serves, and the storefront's search matches `name`.
    const columns = new Map(
      describeEntityColumns(PublishedOffering).map(column => [
        column.name,
        column,
      ]),
    );

    expect(columns.get('categoryId')?.filterable).toBe(true);
    expect(columns.get('brandId')?.filterable).toBe(true);
    expect(columns.get('code')?.filterable).toBe(true);
    expect(columns.get('code')?.sortable).toBe(true);
    expect(columns.get('description')?.filterable).toBe(false);
  });

  it('copies the price rather than pointing at the tenant-side offering', () => {
    // A platform-plane reader cannot dereference a tenant pointer without the
    // isolation break the plane split exists to prevent, and a buyer must see
    // the price that was published, not one edited mid-session.
    const names = describeEntityColumns(PublishedOffering).map(
      column => column.name,
    );

    expect(names).toContain('amount');
    expect(names).toContain('currency');
    expect(names).not.toContain('priceId');
  });

  it('keeps the source offering id as a correlation key, not a link', () => {
    // Republication has to replace the right record and a rebuild has to be
    // idempotent — both need the id. Neither dereferences it.
    const offeringId = describeEntityColumns(PublishedOffering).find(
      column => column.name === 'offeringId',
    );

    expect(offeringId?.type).toBe('string');
    expect(offeringId?.filterable).toBe(true);
  });

  it('names availability a hint, because the reservation is the truth', () => {
    // Published data is eventually consistent on purpose. The name is the
    // guardrail against someone later treating it as a promise.
    const names = describeEntityColumns(PublishedOffering).map(
      column => column.name,
    );

    expect(names).toContain('availableHint');
    expect(names).not.toContain('available');
    expect(names).not.toContain('stock');
  });

  it('orders publications by the moment the publisher decided, not by delivery', () => {
    // The projector's write guard reads this member. Sortable and filterable
    // because they are also the server-side RSQL allowlist: a member without
    // them cannot be queried, and losing the flag is silent at both ends.
    const publishedAt = describeEntityColumns(PublishedOffering).find(
      column => column.name === 'publishedAt',
    );

    expect(publishedAt?.type).toBe('date');
    expect(publishedAt?.sortable).toBe(true);
    expect(publishedAt?.filterable).toBe(true);
  });
});
