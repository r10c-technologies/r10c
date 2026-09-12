import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CommissionEntry } from './commission-entry.entity.js';

const OCCURRED_AT = new Date('2026-03-04T10:00:00.000Z');
const REFUNDED_AT = new Date('2026-03-09T08:00:00.000Z');

describe('CommissionEntry', () => {
  it('serializes one sale’s cut against its order and vendor', () => {
    const entry = new CommissionEntry(
      'order-1',
      'vendor-1',
      1000,
      25,
      'EUR',
      OCCURRED_AT,
    );
    entry.id = 'com-1';

    expect(serializeEntity(CommissionEntry, entry)).toEqual({
      id: 'com-1',
      orderId: 'order-1',
      vendorId: 'vendor-1',
      saleAmount: 1000,
      commissionAmount: 25,
      currency: 'EUR',
      occurredAt: OCCURRED_AT,
      kind: 'sale',
    });
  });

  it('leaves an unsettled entry’s run id out of the record entirely', () => {
    // Absent means unsettled, so the member has to *be* absent rather than
    // present and empty: `runId` exists on a line some run has folded, and a
    // query for unpaid lines asks for the ones without one.
    const entry = new CommissionEntry(
      'order-1',
      'vendor-1',
      1000,
      25,
      'EUR',
      OCCURRED_AT,
    );

    expect(serializeEntity(CommissionEntry, entry)).not.toHaveProperty('runId');
  });

  it('rebuilds itself from a stored record', async () => {
    const entry = await Effect.runPromise(
      deserializeSingleEntity(CommissionEntry, {
        id: 'com-2',
        orderId: 'order-2',
        vendorId: 'vendor-2',
        saleAmount: 4000,
        commissionAmount: 100,
        currency: 'USD',
        // A `Date`, which is what the driver hands back for a BSON date — the
        // capture's ISO string is turned into one by the fold that writes the
        // entry, not by the deserializer that reads it.
        occurredAt: OCCURRED_AT,
        runId: 'run-1',
        kind: 'reversal',
      }),
    );

    expect(entry?.vendorId).toBe('vendor-2');
    expect(entry?.saleAmount).toBe(4000);
    expect(entry?.commissionAmount).toBe(100);
    expect(entry?.occurredAt).toEqual(OCCURRED_AT);
    expect(entry?.runId).toBe('run-1');
    expect(entry?.kind).toBe('reversal');
  });

  it('starts empty at zero, which contributes nothing to a payout', () => {
    const entry = new CommissionEntry();

    expect(entry.orderId).toBe('');
    expect(entry.vendorId).toBe('');
    expect(entry.saleAmount).toBe(0);
    expect(entry.commissionAmount).toBe(0);
    expect(entry.currency).toBe('');
    expect(entry.occurredAt).toBeUndefined();
    expect(entry.runId).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const entry = new CommissionEntry();
    entry.orderId = 'order-3';
    entry.vendorId = 'vendor-3';
    entry.saleAmount = 3000;
    entry.commissionAmount = 75;
    entry.currency = 'GBP';
    entry.occurredAt = OCCURRED_AT;
    entry.runId = 'run-2';

    expect(entry.orderId).toBe('order-3');
    expect(entry.vendorId).toBe('vendor-3');
    expect(entry.saleAmount).toBe(3000);
    expect(entry.commissionAmount).toBe(75);
    expect(entry.currency).toBe('GBP');
    expect(entry.occurredAt).toBe(OCCURRED_AT);
    expect(entry.runId).toBe('run-2');
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
      'saleAmount',
      'commissionAmount',
      'currency',
      'occurredAt',
      'runId',
      'kind',
    ]);
    expect(names).not.toContain('commissionBasisPoints');
  });

  it('states the base as well as the cut, so the line is checkable', () => {
    // A payout is `saleAmount − commissionAmount` summed. Without the base the
    // entry says what the platform took and nothing about what it took a share
    // of, and the payout beside it can only total the platform's own revenue.
    const saleAmount = describeEntityColumns(CommissionEntry).find(
      column => column.name === 'saleAmount',
    );

    expect(saleAmount?.type).toBe('number');
    expect(saleAmount?.required).toBe(true);
  });

  it('makes "every entry for this vendor, unpaid" a first-class query', () => {
    // That sentence *is* a payout, so the fold has to be expressible without a
    // projection — member metadata is also the server-side allowlist, and a
    // query naming a member that lacks it is rejected 400.
    const columns = describeEntityColumns(CommissionEntry);
    const vendorId = columns.find(column => column.name === 'vendorId');
    const runId = columns.find(column => column.name === 'runId');

    expect(vendorId?.filterable).toBe(true);
    expect(runId?.filterable).toBe(true);
  });

  it('lets a run select a period without a projection', () => {
    // `periodStart`/`periodEnd` on a run compare against this member, so it has
    // to be queryable from the entity's own metadata or a run cannot find its
    // own lines.
    const occurredAt = describeEntityColumns(CommissionEntry).find(
      column => column.name === 'occurredAt',
    );

    expect(occurredAt?.type).toBe('date');
    expect(occurredAt?.filterable).toBe(true);
    expect(occurredAt?.sortable).toBe(true);
  });

  it('records a sale unless told otherwise', () => {
    // Every line the fold writes is a sale; only the mirror a cancellation
    // produces is not. Defaulting the other way would make the ordinary case
    // the one every caller has to remember.
    expect(new CommissionEntry().kind).toBe('sale');
  });

  it('mirrors a sale with both signs flipped rather than deleting it', () => {
    // The storno shape. A deletion would leave a total nothing explains, and an
    // edit would erase what the platform actually took — the evidence this
    // ledger exists to hold.
    const sale = new CommissionEntry(
      'order-1',
      'vendor-1',
      1000,
      25,
      'EUR',
      OCCURRED_AT,
    );
    const reversal = new CommissionEntry(
      'order-1',
      'vendor-1',
      -1000,
      -25,
      'EUR',
      REFUNDED_AT,
      'reversal',
    );

    expect(sale.saleAmount + reversal.saleAmount).toBe(0);
    expect(sale.commissionAmount + reversal.commissionAmount).toBe(0);
    // Filed under when the money went back, not when it was taken: a run
    // compares this against its period, and the sale's own date would file the
    // claw-back into a period that may already be settled.
    expect(reversal.occurredAt).toBe(REFUNDED_AT);
  });

  it('makes "only the reversals" a first-class query', () => {
    // Member metadata is also the server-side allowlist, so this one flag is
    // what lets a vendor's statement separate claw-backs from sales. Not
    // sortable: nothing orders a ledger by it.
    const kind = describeEntityColumns(CommissionEntry).find(
      column => column.name === 'kind',
    );

    expect(kind?.type).toBe('enum');
    expect(kind?.enumValues).toEqual(['sale', 'reversal']);
    expect(kind?.filterable).toBe(true);
    expect(kind?.sortable).toBe(false);
  });

  it('can name one of its own records', () => {
    // A record search source refuses a label member that is not simultaneously
    // a string, filterable and sortable, and it throws at module load. Every
    // other member here is a number, a date or an opaque id.
    const vendorId = describeEntityColumns(CommissionEntry).find(
      column => column.name === 'vendorId',
    );

    expect(vendorId?.type).toBe('string');
    expect(vendorId?.sortable).toBe(true);
    expect(vendorId?.filterable).toBe(true);
  });
});
