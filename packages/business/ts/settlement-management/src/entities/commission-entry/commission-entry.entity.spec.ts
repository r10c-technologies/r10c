import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CommissionEntry } from './commission-entry.entity.js';

describe('CommissionEntry', () => {
  it('serializes one sale’s cut against its order and vendor', () => {
    const entry = new CommissionEntry('order-1', 'vendor-1', 25, 'EUR');
    entry.id = 'com-1';

    expect(serializeEntity(CommissionEntry, entry)).toEqual({
      id: 'com-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      commissionAmount: 25,
      currency: 'EUR',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const entry = await Effect.runPromise(
      deserializeSingleEntity(CommissionEntry, {
        id: 'com-2',
        orderId: 'order-2',
        vendorId: 'vendor-2',
        commissionAmount: 100,
        currency: 'USD',
      }),
    );

    expect(entry?.vendorId).toBe('vendor-2');
    expect(entry?.commissionAmount).toBe(100);
  });

  it('starts empty at zero, which contributes nothing to a payout', () => {
    const entry = new CommissionEntry();

    expect(entry.orderId).toBe('');
    expect(entry.vendorId).toBe('');
    expect(entry.commissionAmount).toBe(0);
    expect(entry.currency).toBe('');
  });

  it('accepts the setters a repository writes back through', () => {
    const entry = new CommissionEntry();
    entry.orderId = 'order-3';
    entry.vendorId = 'vendor-3';
    entry.commissionAmount = 75;
    entry.currency = 'GBP';

    expect(entry.orderId).toBe('order-3');
    expect(entry.vendorId).toBe('vendor-3');
    expect(entry.commissionAmount).toBe(75);
    expect(entry.currency).toBe('GBP');
  });

  it('captures the amount rather than a rate to recompute from', () => {
    // Recomputing at payout time would read whatever the agreement says today,
    // so a rate change would silently rewrite history — the same class of bug
    // as storing a price by reference instead of capturing it.
    const names = describeEntityColumns(CommissionEntry).map(
      column => column.name,
    );

    expect(names).toEqual([
      'id',
      'orderId',
      'vendorId',
      'commissionAmount',
      'currency',
    ]);
    expect(names).not.toContain('commissionBasisPoints');
  });

  it('makes "every entry for this vendor" a first-class query', () => {
    // That query *is* a payout, so the fold has to be expressible without a
    // projection — member metadata is also the server-side allowlist.
    const vendorId = describeEntityColumns(CommissionEntry).find(
      column => column.name === 'vendorId',
    );

    expect(vendorId?.filterable).toBe(true);
  });
});
