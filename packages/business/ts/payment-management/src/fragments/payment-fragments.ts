import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-saga-contracts';
import { Schema } from 'effect';

/** The participant every payment fragment calls. */
const PARTICIPANT = 'payment-service';

const PAYMENT = openStruct({ id: Schema.String, status: Schema.String });

/** One vendor order's share of a capture. */
const Share = openStruct({
  orderId: Schema.NonEmptyString,
  vendorId: Schema.NonEmptyString,
  amount: Schema.Number,
});

/**
 * Take the money for the whole checkout group: checkout's pivot, irreversible
 * — a refund is a new record with its own money movement, never the capture's
 * absence (ADR 0054) — and split into one allocation per vendor order. A
 * cash-on-delivery segment takes no capture.
 */
export const paymentCapture = defineFragment({
  id: 'payment.capture',
  version: 2,
  module: 'payment-management',
  kind: 'pivot',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/payment' },
  cardinality: 'one',
  irreversible: true,
  excludedFrom: { paymentMethod: ['cod'] },
  contract: {
    input: openStruct({
      groupId: Schema.NonEmptyString,
      amount: Schema.Number,
      currency: Schema.NonEmptyString,
      allocations: Schema.Array(Share),
    }),
    output: PAYMENT,
    failure: participantRefusal(['invalidBody', 'paymentDeclined']),
  },
});

/**
 * Give money back for one vendor order — all of what is left of its share, or
 * the part asked for: the cancellation's pivot, irreversible for the reason a
 * capture is — un-refunding is charging a customer again (ADR 0058).
 */
export const paymentRefund = defineFragment({
  id: 'payment.refund',
  version: 2,
  module: 'payment-management',
  kind: 'pivot',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/refund' },
  cardinality: 'one',
  irreversible: true,
  contract: {
    input: openStruct({
      orderId: Schema.NonEmptyString,
      amount: Schema.optional(Schema.Number),
    }),
    output: PAYMENT,
    failure: participantRefusal([
      'invalidBody',
      'noCapturedPayment',
      'refundDeclined',
      'refundExceedsCapture',
    ]),
  },
});

/**
 * Record the cash a courier collected for one cash-on-delivery order, after
 * the delivery — so retried, and idempotent on its command.
 */
export const paymentRecordCollection = defineFragment({
  id: 'payment.record-collection',
  version: 1,
  module: 'payment-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/collection' },
  cardinality: 'one',
  isolation: 'commutative',
  contract: {
    input: openStruct({
      groupId: Schema.NonEmptyString,
      orderId: Schema.NonEmptyString,
      vendorId: Schema.NonEmptyString,
      amount: Schema.Number,
      currency: Schema.NonEmptyString,
    }),
    output: PAYMENT,
    failure: participantRefusal(['invalidBody']),
  },
});

/**
 * May this seller's order be paid cash on delivery? A read before the commit
 * point with nothing to undo, so `readOnly`: over the limit, or a seller who
 * does not ship it, refuses the checkout before anything was held.
 */
export const paymentCodEligible = defineFragment({
  id: 'payment.cod-eligible',
  version: 1,
  module: 'payment-management',
  kind: 'compensatable',
  readOnly: true,
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/cod-eligibility' },
  cardinality: 'perVendor',
  isolation: 'reRead',
  contract: {
    input: openStruct({
      vendorId: Schema.NonEmptyString,
      amount: Schema.Number,
    }),
    output: openStruct({ vendorId: Schema.String }),
    failure: participantRefusal([
      'invalidBody',
      'codOverLimit',
      'codNotEntitled',
    ]),
  },
});

/** Every fragment payment-management contributes. */
export const PAYMENT_FRAGMENTS = [
  paymentCapture,
  paymentRefund,
  paymentRecordCollection,
  paymentCodEligible,
] as const;
