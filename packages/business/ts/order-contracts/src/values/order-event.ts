import {
  type AudienceEntry,
  Invalid,
  openStruct,
  registerEvent,
} from '@entifix/core';
import { Effect, Schema } from 'effect';

const invalidPayload = (detail: string) =>
  new Invalid({ errors: [{ pointer: '/data', detail, code: 'malformed' }] });

export const ORDER_PLACED = 'order.placed';

export const ORDER_CANCELLED = 'order.cancelled';

export const ORDER_EVENTS = [ORDER_PLACED, ORDER_CANCELLED] as const;

/** One vendor-tagged line, as an order event carries it. */
const OrderLineSchema = openStruct({
  /** The vendor that owes this line. */
  vendorId: Schema.NonEmptyString,
  /** Minor units, **per unit**. */
  amount: Schema.Finite,
  quantity: Schema.Finite,
  currency: Schema.NonEmptyString,
});

/**
 * What an order event's `data` must hold: the serialized order, with an id,
 * at least one vendor-tagged line, and — when it came through one — a channel
 * that says its type. Pricing a channel that refuses to say which as though
 * there were none would quietly charge the default rate.
 *
 * Registered for both names, so the publisher encodes and every consumer
 * decodes against this one schema (ADR 0068).
 */
export const OrderEventSchema = openStruct({
  id: Schema.NonEmptyString,
  items: Schema.Array(OrderLineSchema).check(Schema.isMinLength(1)),
  channel: Schema.optional(Schema.NullOr(openStruct({ type: Schema.String }))),
});

for (const name of ORDER_EVENTS)
  registerEvent(name, OrderEventSchema, { versioned: true });

/**
 * Who an order event is for: the buyer's party, when the buyer signed in, and
 * the organization of every vendor on the order.
 */
export const orderAudience = (order: {
  readonly buyerId?: string | undefined;
  readonly items?: readonly { readonly vendorId: string }[] | undefined;
}): AudienceEntry[] => [
  ...(order.buyerId === undefined
    ? []
    : [{ kind: 'party' as const, id: order.buyerId }]),
  ...Array.from(new Set((order.items ?? []).map(item => item.vendorId))).map(
    id => ({
      kind: 'organization' as const,
      id,
    }),
  ),
];

export interface PlacedOrderLine {
  readonly vendorId: string;
  readonly amount: number;
  readonly quantity: number;
  readonly currency: string;
}

export interface PlacedOrder {
  readonly orderId: string;
  readonly lines: readonly PlacedOrderLine[];
  /**
   * The channel **type** the sale came through, absent for a storefront
   * checkout. The type travels on the order as a denormalized copy so a
   * platform-plane reader can price by it without a tenant handle (ADR 0024).
   */
  readonly channelType?: string;
}

/** Reads an order event's `data` through the registered schema. */
export const readPlacedOrder = (
  data: unknown,
): Effect.Effect<PlacedOrder, Invalid> =>
  Effect.map(
    Schema.decodeUnknownEffect(OrderEventSchema)(data, { errors: 'all' }).pipe(
      Effect.mapError(error =>
        invalidPayload(`order payload is malformed: ${error.message}`),
      ),
    ),
    order => ({
      orderId: order.id,
      lines: order.items.map(({ vendorId, amount, quantity, currency }) => ({
        vendorId,
        amount,
        quantity,
        currency,
      })),
      ...(order.channel === undefined || order.channel === null
        ? {}
        : { channelType: order.channel.type }),
    }),
  );

/** `order.cancelled` carries the same order, so it reads the same way. */
export const readCancelledOrder = readPlacedOrder;
