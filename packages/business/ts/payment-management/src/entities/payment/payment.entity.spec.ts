import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Payment } from './payment.entity.js';

describe('Payment', () => {
  it('serializes the attempt with the provider reference it produced', () => {
    const payment = new Payment('order-1', 1250, 'EUR');
    payment.id = 'pay-1';
    payment.status = 'captured';
    payment.providerReference = 'psp_abc123';

    expect(serializeEntity(Payment, payment)).toEqual({
      id: 'pay-1',
      orderId: 'order-1',
      amount: 1250,
      currency: 'EUR',
      status: 'captured',
      providerReference: 'psp_abc123',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const payment = await Effect.runPromise(
      deserializeSingleEntity(Payment, {
        id: 'pay-2',
        orderId: 'order-2',
        amount: 400,
        currency: 'USD',
        status: 'failed',
        providerReference: undefined,
      }),
    );

    expect(payment?.status).toBe('failed');
    expect(payment?.amount).toBe(400);
    expect(payment?.providerReference).toBeUndefined();
  });

  it('starts pending with no provider reference, because nothing was called yet', () => {
    const payment = new Payment();

    expect(payment.orderId).toBe('');
    expect(payment.amount).toBe(0);
    expect(payment.currency).toBe('');
    expect(payment.status).toBe('pending');
    expect(payment.providerReference).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const payment = new Payment();
    payment.orderId = 'order-3';
    payment.amount = 700;
    payment.currency = 'GBP';
    payment.status = 'authorized';
    payment.providerReference = undefined;

    expect(payment.orderId).toBe('order-3');
    expect(payment.amount).toBe(700);
    expect(payment.currency).toBe('GBP');
    expect(payment.status).toBe('authorized');
    expect(payment.providerReference).toBeUndefined();
  });

  it('makes the provider reference findable, since reconciliation starts there', () => {
    // It is the only member belonging to a foreign system, and the sole handle
    // for a chargeback later — so it is stored rather than derived.
    const reference = describeEntityColumns(Payment).find(
      column => column.name === 'providerReference',
    );

    expect(reference?.filterable).toBe(true);
    expect(reference?.required).not.toBe(true);
  });

  it('links the order by id rather than by a link accessor', () => {
    // The target is another slice's store, and a `link` would invite the
    // storage-layer join the one-writer rule forbids.
    const orderId = describeEntityColumns(Payment).find(
      column => column.name === 'orderId',
    );

    expect(orderId?.type).toBe('string');
    expect(orderId?.filterable).toBe(true);
  });
});
