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

    expect(serializeEntity(PublishedOffering, published)).toEqual({
      id: 'pub-1',
      offeringId: 'off-1',
      vendorId: 'vendor-1',
      name: 'Blue widget, 3-pack',
      amount: 1050,
      currency: 'EUR',
      availableHint: true,
    });
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
      }),
    );

    expect(published?.name).toBe('Red widget');
    expect(published?.availableHint).toBe(false);
  });

  it('defaults to unavailable, so a half-built projection oversells nothing', () => {
    const published = new PublishedOffering();

    expect(published.offeringId).toBe('');
    expect(published.vendorId).toBe('');
    expect(published.name).toBe('');
    expect(published.amount).toBe(0);
    expect(published.currency).toBe('');
    expect(published.availableHint).toBe(false);
  });

  it('accepts the setters the projector writes through', () => {
    const published = new PublishedOffering();
    published.offeringId = 'off-3';
    published.vendorId = 'vendor-3';
    published.name = 'Green widget';
    published.amount = 250;
    published.currency = 'GBP';
    published.availableHint = true;

    expect(published.offeringId).toBe('off-3');
    expect(published.vendorId).toBe('vendor-3');
    expect(published.name).toBe('Green widget');
    expect(published.amount).toBe(250);
    expect(published.currency).toBe('GBP');
    expect(published.availableHint).toBe(true);
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
});
