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
      paymentMethod: 'card',
      providerReference: 'psp_abc123',
    });
  });

  it('records cash taken at a counter, with a channel and no provider', () => {
    // The case the two members exist for: before in-site selling every payment
    // was a storefront card, so both were inferable (ADR 0024). Cash has no
    // provider to answer, so `providerReference` stays absent.
    const payment = new Payment('order-9', 500, 'EUR');
    payment.status = 'captured';
    payment.paymentMethod = 'cash';
    payment.channelId = 'sc-1';

    expect(serializeEntity(Payment, payment)).toEqual({
      orderId: 'order-9',
      amount: 500,
      currency: 'EUR',
      status: 'captured',
      paymentMethod: 'cash',
      channelId: 'sc-1',
    });
  });

  it('makes the channel findable, because "what did this counter take today" is\n    the question it exists to answer', () => {
    const channelId = describeEntityColumns(Payment).find(
      column => column.name === 'channelId',
    );

    expect(channelId?.filterable).toBe(true);
  });

  it('holds the channel as a bare id, not a copy like the order does', () => {
    // A payment is read by the vendor and by settlement, both of which can
    // resolve the channel in the store that owns it. An order is read by a buyer
    // who holds no tenant handle, which is why that one carries a copy.
    const channelId = describeEntityColumns(Payment).find(
      column => column.name === 'channelId',
    );

    expect(channelId?.type).toBe('string');
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
    expect(payment.paymentMethod).toBe('card');
    expect(payment.channelId).toBeUndefined();
  });

  it('accepts the setters a repository writes back through', () => {
    const payment = new Payment();
    payment.orderId = 'order-3';
    payment.amount = 700;
    payment.currency = 'GBP';
    payment.status = 'authorized';
    payment.paymentMethod = 'transfer';
    payment.channelId = 'sc-2';
    payment.providerReference = undefined;

    expect(payment.orderId).toBe('order-3');
    expect(payment.amount).toBe(700);
    expect(payment.currency).toBe('GBP');
    expect(payment.status).toBe('authorized');
    expect(payment.paymentMethod).toBe('transfer');
    expect(payment.channelId).toBe('sc-2');
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
