import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-saga-contracts';
import { Schema } from 'effect';

import { ORDER_NOT_CANCELLABLE } from '../use-cases/cancel-product-order/cancel-product-order.uc';

/** The participant every order fragment calls. */
const PARTICIPANT = 'order-service';

/** An order's id, provided by its write. */
const OrderId = Schema.String;

const ORDER = openStruct({ id: OrderId, status: Schema.String });

/** Write the buyer's receipt. Compensated by deleting it. */
export const orderWrite = defineFragment({
  id: 'order.write',
  version: 1,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order' },
  compensation: { method: 'DELETE', path: '/api/product-order/:id' },
  cardinality: 'one',
  isolation: 'none',
  provides: { orderId: OrderId },
  contract: {
    input: openStruct({ items: Schema.Array(Schema.Unknown) }),
    output: ORDER,
    failure: participantRefusal(['invalidBody']),
  },
});

/**
 * Claim a paid order for cancellation. The claim is a semantic lock: while it
 * is held, fulfilment and a second cancellation see `cancelling` and back off
 * (ADR 0058). Compensated by releasing it.
 */
export const orderClaimCancel = defineFragment({
  id: 'order.claim-cancel',
  version: 1,
  module: 'order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:id/cancelling' },
  compensation: {
    method: 'DELETE',
    path: '/api/product-order/:id/cancelling',
  },
  cardinality: 'one',
  isolation: 'semanticLock',
  contract: {
    input: Schema.Struct({}),
    output: ORDER,
    failure: participantRefusal(['notFound', ORDER_NOT_CANCELLABLE]),
  },
});

/**
 * Close a claimed order as cancelled. After the refund, so retried; it re-reads
 * the order rather than trusting what the claim saw.
 */
export const orderCloseCancelled = defineFragment({
  id: 'order.close-cancelled',
  version: 1,
  module: 'order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/product-order/:id/cancelled' },
  cardinality: 'one',
  isolation: 'reRead',
  contract: {
    input: Schema.Struct({}),
    output: ORDER,
    failure: participantRefusal(['notFound']),
  },
});

/** Every fragment order-management contributes. */
export const ORDER_FRAGMENTS = [
  orderWrite,
  orderClaimCancel,
  orderCloseCancelled,
] as const;
