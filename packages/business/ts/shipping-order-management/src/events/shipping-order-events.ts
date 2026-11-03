import {
  type AggregateRef,
  type DomainEvent,
  openStruct,
  registerEvent,
} from '@entifix/core';
import { Schema } from 'effect';

import type { ShippingTransition } from '../values/shipping-transition';

/**
 * What a shipment announces once it moves past dispatch: the delivery flow
 * waits on these to know a parcel left, arrived, was refused or came back
 * (ADR 0070), and the vendor's open tabs hear of them.
 */
export const SHIPPING_ORDER_DISPATCHED = 'shipping-order.dispatched';
export const SHIPPING_ORDER_DELIVERED = 'shipping-order.delivered';
export const SHIPPING_ORDER_REFUSED = 'shipping-order.refused';
export const SHIPPING_ORDER_RETURNED = 'shipping-order.returned';

export const SHIPPING_ORDER_EVENTS = [
  SHIPPING_ORDER_DISPATCHED,
  SHIPPING_ORDER_DELIVERED,
  SHIPPING_ORDER_REFUSED,
  SHIPPING_ORDER_RETURNED,
] as const;

export type ShippingOrderEventName = (typeof SHIPPING_ORDER_EVENTS)[number];

/** The event a move announces, when it announces one. */
export const EVENT_OF: Partial<
  Record<ShippingTransition, ShippingOrderEventName>
> = {
  dispatch: SHIPPING_ORDER_DISPATCHED,
  'record-delivery': SHIPPING_ORDER_DELIVERED,
  'record-refusal': SHIPPING_ORDER_REFUSED,
  'record-return': SHIPPING_ORDER_RETURNED,
};

/**
 * What a shipping-order event carries: the shipment as its move left it, with
 * the order and the flow that waits on it — the flow id is what a waiting
 * delivery flow correlates the event with.
 */
export const ShippingOrderEventSchema = openStruct({
  id: Schema.NonEmptyString,
  orderId: Schema.NonEmptyString,
  groupId: Schema.String,
  status: Schema.NonEmptyString,
  paymentMethod: Schema.NonEmptyString,
  amountDue: Schema.Finite,
  currency: Schema.String,
});

for (const name of SHIPPING_ORDER_EVENTS)
  registerEvent(name, ShippingOrderEventSchema, {
    versioned: true,
    audience: 'required',
  });

/** A shipment's lifecycle is linear, so each event is a fixed version of it. */
const VERSION: Record<ShippingOrderEventName, number> = {
  [SHIPPING_ORDER_DISPATCHED]: 1,
  [SHIPPING_ORDER_DELIVERED]: 2,
  [SHIPPING_ORDER_REFUSED]: 2,
  [SHIPPING_ORDER_RETURNED]: 3,
};

/**
 * A move as a routable message from `source`, addressed to the one vendor whose
 * store it moved, correlated on the delivery flow it signals.
 */
export const shippingOrderEvent = (
  name: ShippingOrderEventName,
  organizationId: string,
  data: Record<string, unknown> & {
    readonly id: string;
    readonly flowId?: string;
  },
  source: string,
): DomainEvent<Record<string, unknown>> & {
  aggregate: AggregateRef;
  version: number;
} => ({
  name,
  id: `${data.id}:${name.split('.')[1] as string}`,
  source,
  at: new Date().toISOString(),
  correlationId: data.flowId ?? data.id,
  aggregate: { type: 'shipping-order', id: data.id },
  version: VERSION[name],
  audience: [{ kind: 'organization', id: organizationId }],
  data,
});
