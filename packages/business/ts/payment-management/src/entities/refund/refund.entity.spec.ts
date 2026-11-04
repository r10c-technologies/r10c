import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Refund } from './refund.entity.js';

describe('Refund', () => {
  it('serializes the reversal with its own provider reference', () => {
    const refund = new Refund('order-1', 'alloc-1', 1250, 'EUR');
    refund.id = 'ref-1';
    refund.status = 'refunded';
    refund.providerReference = 'sim_refund_ref-1';
    const decidedAt = new Date('2026-09-11T10:00:00.000Z');
    refund.decidedAt = decidedAt;

    // A `date` member serializes as a `Date`, not as an ISO string — the Mongo
    // driver stores it natively and the wire encoder is what turns it into text.
    expect(serializeEntity(Refund, refund)).toEqual({
      id: 'ref-1',
      allocationId: 'alloc-1',
      orderId: 'order-1',
      amount: 1250,
      currency: 'EUR',
      status: 'refunded',
      providerReference: 'sim_refund_ref-1',
      decidedAt,
    });
  });

  it('carries both ids: one it reverses, one it is addressed by', () => {
    // `allocationId` is the share of a capture a refund gives back from.
    // `orderId` is how the route is addressed, because the cancellation saga
    // holds an order and has never seen a payment id.
    const columns = describeEntityColumns(Refund);
    const allocationId = columns.find(column => column.name === 'allocationId');
    const orderId = columns.find(column => column.name === 'orderId');

    expect(allocationId?.type).toBe('string');
    expect(allocationId?.filterable).toBe(true);
    expect(orderId?.type).toBe('string');
    expect(orderId?.filterable).toBe(true);
  });

  it('makes the decision time readable, unlike a bare document field', () => {
    // A member without a getter is invisible to every adapter (#249), which is
    // the defect `Payment.decidedAt` still has.
    const decidedAt = describeEntityColumns(Refund).find(
      column => column.name === 'decidedAt',
    );

    expect(decidedAt?.type).toBe('date');
    expect(decidedAt?.sortable).toBe(true);
  });

  it('rebuilds itself from a stored record', async () => {
    const refund = await Effect.runPromise(
      deserializeSingleEntity(Refund, {
        id: 'ref-2',
        allocationId: 'alloc-2',
        orderId: 'order-2',
        amount: 400,
        currency: 'USD',
        status: 'failed',
        providerReference: undefined,
      }),
    );

    expect(refund?.status).toBe('failed');
    expect(refund?.amount).toBe(400);
    expect(refund?.allocationId).toBe('alloc-2');
    expect(refund?.providerReference).toBeUndefined();
  });

  it('starts pending with nothing decided, because no provider was called yet', () => {
    const refund = new Refund();

    expect(refund.orderId).toBe('');
    expect(refund.allocationId).toBe('');
    expect(refund.amount).toBe(0);
    expect(refund.currency).toBe('');
    expect(refund.status).toBe('pending');
    expect(refund.providerReference).toBeUndefined();
    expect(refund.decidedAt).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const refund = new Refund();
    refund.orderId = 'order-3';
    refund.allocationId = 'alloc-3';
    refund.amount = 700;
    refund.currency = 'GBP';
    refund.status = 'refunded';
    refund.providerReference = undefined;
    refund.decidedAt = undefined;

    expect(refund.orderId).toBe('order-3');
    expect(refund.allocationId).toBe('alloc-3');
    expect(refund.amount).toBe(700);
    expect(refund.currency).toBe('GBP');
    expect(refund.status).toBe('refunded');
    expect(refund.providerReference).toBeUndefined();
    expect(refund.decidedAt).toBeUndefined();
  });
});
