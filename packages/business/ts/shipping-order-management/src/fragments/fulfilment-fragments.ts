import { defineFragment } from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { participantRefusal } from '@r10c/business-ts-flow-contracts';
import { Schema } from 'effect';

import { SHIPPING_ORDER_NOT_TRANSITIONABLE } from '../failures/shipping-failures';

/** The participant every fulfilment fragment calls. */
const PARTICIPANT = 'fulfilment-service';

/**
 * A shipment's id, provided by its opening. It is the vendor order's own id —
 * one shipment per order — so a flow on an order that already exists names its
 * shipment without having opened it.
 */
const ShippingOrderId = Schema.String;

const SHIPMENT = openStruct({ id: ShippingOrderId, status: Schema.String });

const REQUIRES = { entitlements: ['shipping-order-management'] } as const;

/** The refusal every move on an open shipment can answer. */
const MOVE_REFUSAL = participantRefusal([
  'notFound',
  SHIPPING_ORDER_NOT_TRANSITIONABLE,
]);

/**
 * Open the vendor's shipment for one vendor order. After the checkout's commit
 * point, so retried rather than compensated; an open repeated on its command
 * answers the first shipment.
 */
export const fulfilmentOpen = defineFragment({
  id: 'fulfilment.open',
  version: 2,
  module: 'shipping-order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/shipping-order' },
  cardinality: 'perVendor',
  isolation: 'none',
  requires: REQUIRES,
  consumes: { orderId: Schema.String, groupId: Schema.String },
  provides: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({
      orderId: Schema.NonEmptyString,
      groupId: Schema.NonEmptyString,
      paymentMethod: Schema.NonEmptyString,
      amountDue: Schema.Number,
      currency: Schema.NonEmptyString,
      lines: Schema.Array(Schema.Unknown),
    }),
    output: SHIPMENT,
    failure: participantRefusal(['invalidBody']),
  },
});

/**
 * Hold a shipment before dispatch — a cancellation's semantic lock. Exactly one
 * of a hold and a dispatch racing on one shipment wins, because both are one
 * conditional write on its status (ADR 0070). Compensated by releasing it.
 */
export const fulfilmentHold = defineFragment({
  id: 'fulfilment.hold',
  version: 2,
  module: 'shipping-order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'POST', path: '/api/shipping-order/:shippingOrderId/hold' },
  compensation: {
    method: 'DELETE',
    path: '/api/shipping-order/:shippingOrderId/hold',
  },
  cardinality: 'one',
  isolation: 'semanticLock',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: MOVE_REFUSAL,
  },
});

/** Let a held shipment go back to awaiting dispatch; undone by holding again. */
export const fulfilmentRelease = defineFragment({
  id: 'fulfilment.release',
  version: 2,
  module: 'shipping-order-management',
  kind: 'compensatable',
  participant: PARTICIPANT,
  call: { method: 'DELETE', path: '/api/shipping-order/:shippingOrderId/hold' },
  compensation: {
    method: 'POST',
    path: '/api/shipping-order/:shippingOrderId/hold',
  },
  cardinality: 'one',
  isolation: 'semanticLock',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: MOVE_REFUSAL,
  },
});

/** Withdraw a shipment that will never ship. After a cancellation's pivot. */
export const fulfilmentWithdraw = defineFragment({
  id: 'fulfilment.withdraw',
  version: 2,
  module: 'shipping-order-management',
  kind: 'retriable',
  participant: PARTICIPANT,
  call: {
    method: 'POST',
    path: '/api/shipping-order/:shippingOrderId/withdrawal',
  },
  cardinality: 'one',
  isolation: 'reRead',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: MOVE_REFUSAL,
  },
});

/**
 * Hand the parcel to a courier: the delivery flow's pivot, and irreversible —
 * goods that left come back only as a return. It takes the same semantic lock
 * a hold does, so a dispatch never lands on a cancellation in flight.
 */
export const fulfilmentDispatch = defineFragment({
  id: 'fulfilment.dispatch',
  version: 2,
  module: 'shipping-order-management',
  kind: 'pivot',
  participant: PARTICIPANT,
  call: {
    method: 'POST',
    path: '/api/shipping-order/:shippingOrderId/dispatch-step',
  },
  cardinality: 'one',
  irreversible: true,
  isolation: 'semanticLock',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: MOVE_REFUSAL,
  },
});

/**
 * Wait for the courier's report: completed by `shipping-order.delivered` or
 * `.refused`, timed out by the delivery window. A wait makes no call; the one
 * named is the read that says where the shipment stands.
 */
export const fulfilmentAwaitDelivery = defineFragment({
  id: 'fulfilment.await-delivery',
  version: 2,
  module: 'shipping-order-management',
  kind: 'wait',
  participant: PARTICIPANT,
  call: { method: 'GET', path: '/api/shipping-order/:shippingOrderId' },
  cardinality: 'one',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: participantRefusal([]),
  },
});

/** Wait for a refused or returned parcel to reach the vendor again. */
export const fulfilmentAwaitReturn = defineFragment({
  id: 'fulfilment.await-return',
  version: 2,
  module: 'shipping-order-management',
  kind: 'wait',
  participant: PARTICIPANT,
  call: { method: 'GET', path: '/api/shipping-order/:shippingOrderId' },
  cardinality: 'one',
  requires: REQUIRES,
  consumes: { shippingOrderId: ShippingOrderId },
  contract: {
    input: openStruct({ shippingOrderId: ShippingOrderId }),
    output: SHIPMENT,
    failure: participantRefusal([]),
  },
});

/** Every fragment shipping-order-management contributes. */
export const FULFILMENT_FRAGMENTS = [
  fulfilmentOpen,
  fulfilmentHold,
  fulfilmentRelease,
  fulfilmentWithdraw,
  fulfilmentDispatch,
  fulfilmentAwaitDelivery,
  fulfilmentAwaitReturn,
] as const;
