import type { EnumTone } from '@entifix/core';

/**
 * Where a shipment is in its life.
 *
 * `awaiting-dispatch` is where {@link ShippingOrder} opens. Before dispatch a
 * cancellation may `hold` it — the semantic lock that serializes a cancel
 * against a dispatch on one conditional write — and either `release` it or
 * `withdraw` it for good. `dispatch` is the delivery flow's pivot: from
 * `dispatched` the goods are with a courier, and the shipment ends `delivered`
 * or `refused`, and either may come back `returned`
 * ([ADR 0070](../../../../../docs/adr/0070-fulfilment-and-cash-on-delivery.md)).
 */
export const ShippingStatuses = [
  'awaiting-dispatch',
  'held',
  'dispatched',
  'delivered',
  'refused',
  'returned',
  'withdrawn',
] as const;

export type ShippingStatus = (typeof ShippingStatuses)[number];

/**
 * A status read at a glance: a shipment waiting on the vendor warns, one with
 * the courier is information, and its end reads as delivered or as failed. A value with no tone reads neutral.
 */
export const ShippingStatusTones = {
  'awaiting-dispatch': 'warning',
  held: 'warning',
  dispatched: 'info',
  delivered: 'success',
  refused: 'danger',
  returned: 'danger',
} as const satisfies Readonly<Partial<Record<ShippingStatus, EnumTone>>>;

/** Narrow an unknown value to a shipping status. */
export const isShippingStatus = (value: unknown): value is ShippingStatus =>
  typeof value === 'string' &&
  (ShippingStatuses as readonly string[]).includes(value);
