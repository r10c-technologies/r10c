import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Agreement } from './agreement.entity.js';

describe('Agreement', () => {
  it('serializes the commission term with the date it starts applying', () => {
    const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');
    const agreement = new Agreement('vendor-1', 250);
    agreement.id = 'agr-1';
    agreement.effectiveFrom = effectiveFrom;

    expect(serializeEntity(Agreement, agreement)).toEqual({
      id: 'agr-1',
      vendorId: 'vendor-1',
      commissionBasisPoints: 250,
      effectiveFrom,
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const agreement = await Effect.runPromise(
      deserializeSingleEntity(Agreement, {
        id: 'agr-2',
        vendorId: 'vendor-2',
        commissionBasisPoints: 1000,
        effectiveFrom: new Date('2026-02-01T00:00:00.000Z'),
      }),
    );

    expect(agreement?.vendorId).toBe('vendor-2');
    expect(agreement?.commissionBasisPoints).toBe(1000);
  });

  it('starts at zero commission, which takes nothing by default', () => {
    const agreement = new Agreement();

    expect(agreement.vendorId).toBe('');
    expect(agreement.commissionBasisPoints).toBe(0);
    expect(agreement.effectiveFrom).toBeUndefined();
    expect(agreement.channelCommissionBasisPoints).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const agreement = new Agreement();
    agreement.vendorId = 'vendor-3';
    agreement.commissionBasisPoints = 500;
    agreement.effectiveFrom = undefined;
    agreement.channelCommissionBasisPoints = undefined;

    expect(agreement.vendorId).toBe('vendor-3');
    expect(agreement.commissionBasisPoints).toBe(500);
    expect(agreement.effectiveFrom).toBeUndefined();
    expect(agreement.channelCommissionBasisPoints).toBeUndefined();
  });

  it('holds commission as integer basis points, never a float percentage', () => {
    // 250 is 2.5%. A percentage held as a float compounds a rounding error
    // across every line of every payout.
    const agreement = new Agreement('vendor-4', 250);

    expect(Number.isInteger(agreement.commissionBasisPoints)).toBe(true);
    expect((10_000 * agreement.commissionBasisPoints) / 10_000).toBe(250);
  });

  it('prices a counter sale at nothing while the storefront still pays', () => {
    // The term per-channel rates exist for: the platform has a much weaker claim
    // on a sale the vendor made to their own walk-in than on one it sourced
    // (ADR 0024).
    const agreement = new Agreement('vendor-5', 800);
    agreement.channelCommissionBasisPoints = { counter: 0 };

    expect(agreement.commissionFor('counter')).toBe(0);
    expect(agreement.commissionFor('storefront')).toBe(800);
    expect(agreement.commissionFor(undefined)).toBe(800);
  });

  it('serializes the rate table and rebuilds from it', () => {
    const agreement = new Agreement('vendor-6', 800);
    agreement.channelCommissionBasisPoints = { counter: 0, phone: 400 };

    expect(serializeEntity(Agreement, agreement)).toEqual({
      vendorId: 'vendor-6',
      commissionBasisPoints: 800,
      channelCommissionBasisPoints: { counter: 0, phone: 400 },
    });
  });

  it('keeps the rate table out of the query allowlist', () => {
    // An embedded object compared as a scalar matches nothing, and member
    // metadata is the server-side RSQL allowlist. Settling reads the whole
    // agreement; it never selects one by its rate table.
    const rates = describeEntityColumns(Agreement).find(
      column => column.name === 'channelCommissionBasisPoints',
    );

    expect(rates?.filterable).toBe(false);
    expect(rates?.sortable).toBe(false);
  });

  it('lets a settlement find the agreement in force during a period', () => {
    // Settling means finding the agreement that applied *then*, not the latest
    // one — which is why the effective date is both sortable and filterable.
    const effectiveFrom = describeEntityColumns(Agreement).find(
      column => column.name === 'effectiveFrom',
    );

    expect(effectiveFrom?.type).toBe('date');
    expect(effectiveFrom?.sortable).toBe(true);
    expect(effectiveFrom?.filterable).toBe(true);
  });
});
