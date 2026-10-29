import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-saga-contracts';
import { Schema } from 'effect';

/** The participant every payment fragment calls. */
const PARTICIPANT = 'payment-service';

/**
 * Take the money: checkout's pivot, and irreversible — a refund is a new
 * record with its own money movement, never the capture's absence (ADR 0054).
 * A cash-on-delivery segment takes no capture.
 */
export const paymentCapture = defineFragment({
  id: 'payment.capture',
  version: 1,
  module: 'payment-management',
  kind: 'pivot',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/payment' },
  cardinality: 'one',
  irreversible: true,
  excludedFrom: { paymentMethod: ['cashOnDelivery'] },
  contract: {
    input: openStruct({
      orderId: Schema.NonEmptyString,
      amount: Schema.Number,
      currency: Schema.NonEmptyString,
    }),
    output: openStruct({ id: Schema.String, status: Schema.String }),
    failure: participantRefusal(['invalidBody', 'paymentDeclined']),
  },
});

/**
 * Give the money back: the cancellation's pivot, irreversible for the reason
 * a capture is — un-refunding is charging a customer again (ADR 0058).
 */
export const paymentRefund = defineFragment({
  id: 'payment.refund',
  version: 1,
  module: 'payment-management',
  kind: 'pivot',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/refund' },
  cardinality: 'one',
  irreversible: true,
  contract: {
    input: openStruct({ orderId: Schema.NonEmptyString }),
    output: openStruct({ id: Schema.String, status: Schema.String }),
    failure: participantRefusal([
      'invalidBody',
      'noCapturedPayment',
      'refundDeclined',
    ]),
  },
});

/** Every fragment payment-management contributes. */
export const PAYMENT_FRAGMENTS = [paymentCapture, paymentRefund] as const;
