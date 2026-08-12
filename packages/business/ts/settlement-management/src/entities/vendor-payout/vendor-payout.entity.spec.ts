import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { VendorPayout } from './vendor-payout.entity.js';

describe('VendorPayout', () => {
  it('serializes what one vendor is owed for one run', () => {
    const payout = new VendorPayout('run-1', 'vendor-1', 4200, 'EUR');
    payout.id = 'pay-1';

    expect(serializeEntity(VendorPayout, payout)).toEqual({
      id: 'pay-1',
      runId: 'run-1',
      vendorId: 'vendor-1',
      amount: 4200,
      currency: 'EUR',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const payout = await Effect.runPromise(
      deserializeSingleEntity(VendorPayout, {
        id: 'pay-2',
        runId: 'run-2',
        vendorId: 'vendor-2',
        amount: 99,
        currency: 'USD',
      }),
    );

    expect(payout?.runId).toBe('run-2');
    expect(payout?.amount).toBe(99);
  });

  it('starts at zero owed', () => {
    const payout = new VendorPayout();

    expect(payout.runId).toBe('');
    expect(payout.vendorId).toBe('');
    expect(payout.amount).toBe(0);
    expect(payout.currency).toBe('');
  });

  it('accepts the setters a repository writes back through', () => {
    const payout = new VendorPayout();
    payout.runId = 'run-3';
    payout.vendorId = 'vendor-3';
    payout.amount = 1500;
    payout.currency = 'GBP';

    expect(payout.runId).toBe('run-3');
    expect(payout.vendorId).toBe('vendor-3');
    expect(payout.amount).toBe(1500);
    expect(payout.currency).toBe('GBP');
  });

  it('belongs to a run rather than carrying its own date range', () => {
    // "Everything in the March run" is then one query, and a re-run cannot
    // half-replace a period.
    const names = describeEntityColumns(VendorPayout).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'runId', 'vendorId', 'amount', 'currency']);
    expect(names).not.toContain('periodStart');
  });

  it('is findable by run and by vendor, the two ways a payout is looked up', () => {
    const filterable = describeEntityColumns(VendorPayout)
      .filter(column => column.filterable)
      .map(column => column.name);

    expect(filterable).toContain('runId');
    expect(filterable).toContain('vendorId');
  });
});
