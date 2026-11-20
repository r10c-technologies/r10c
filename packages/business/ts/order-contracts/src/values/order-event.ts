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

/**
 * A seller confirmed the payment a payment-link order waited on. Published
 * because a subscriber exists: the checkout flow's wait is answered by it
 * (ADR 0068, ADR 0081 §4).
 */
export const ORDER_PAYMENT_CONFIRMED = 'order.payment-confirmed';

/**
 * The parcel left with a courier, and the order carries its guide. Published
 * because a subscriber exists: the realtime slice pushes it to the buyer's
 * open receipt, so it moves to "on its way" without a reload (ADR 0081 §11).
 */
export const ORDER_DISPATCHED = 'order.dispatched';

/** The order reached its buyer. Published for the buyer's receipt, as above. */
export const ORDER_FULFILLED = 'order.fulfilled';

export const ORDER_EVENTS = [
  ORDER_PLACED,
  ORDER_PAYMENT_CONFIRMED,
  ORDER_DISPATCHED,
  ORDER_FULFILLED,
  ORDER_CANCELLED,
] as const;

/**
 * One line, as an order event carries it: what was sold, at what unit price,
 * how many, and its tax (ADR 0078 §2). Every member is required — a line with
 * no tax is not a smaller line, it is a wrong ledger entry.
 */
const OrderLineSchema = openStruct({
  offeringId: Schema.NonEmptyString,
  /** The description as sold, copied onto the line at placement. */
  name: Schema.String,
  /**
   * The specification version the line sold, by record id and number
   * (ADR 0079 §3). `description` rides beside them when the specification had
   * one, and is left to the open struct.
   */
  specificationId: Schema.NonEmptyString,
  specificationVersion: Schema.Finite,
  /** Minor units, **per unit**. */
  amount: Schema.Finite,
  quantity: Schema.Finite,
  currency: Schema.NonEmptyString,
  kind: Schema.NonEmptyString,
  taxTreatment: Schema.NonEmptyString,
  taxRate: Schema.Finite,
  /** Minor units, for the whole line. */
  taxableBase: Schema.Finite,
  taxAmount: Schema.Finite,
});

/**
 * The seller's fiscal identity, copied onto the order at placement. The id,
 * name and establishment are strings that may still be empty — a seller who has
 * not stated them yet sells all the same — while the regime always has a value.
 */
const SellerTaxSchema = openStruct({
  taxId: Schema.String,
  legalName: Schema.String,
  taxRegime: Schema.NonEmptyString,
  establishmentCode: Schema.String,
});

/**
 * What an order event's `data` must hold: the vendor order **as a whole fact**
 * (ADR 0078 §2) — its id, the one vendor it belongs to, its checkout group and
 * tender, at least one complete line, the seller's fiscal identity and the
 * document's net, tax and total. A consumer that has seen only this event and
 * its own store can write its record.
 *
 * When the order came through a channel, the channel says its type. Pricing a
 * channel that refuses to say which as though there were none would quietly
 * charge the default rate (ADR 0069).
 *
 * ⚠️ **The buyer's fiscal identity is not here, and never will be.** It rides
 * only the fiscal-document event, which no browser receives (ADR 0078 §2).
 *
 * Registered for every name, so the publisher encodes and every consumer
 * decodes against this one schema (ADR 0068). Decoding stays open: a member a
 * consumer does not read is let through.
 */
export const OrderEventSchema = openStruct({
  id: Schema.NonEmptyString,
  vendorId: Schema.NonEmptyString,
  groupId: Schema.NonEmptyString,
  paymentMethod: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
  items: Schema.Array(OrderLineSchema).check(Schema.isMinLength(1)),
  sellerTax: SellerTaxSchema,
  netAmount: Schema.Finite,
  taxAmount: Schema.Finite,
  totalAmount: Schema.Finite,
  currency: Schema.NonEmptyString,
  channel: Schema.optional(Schema.NullOr(openStruct({ type: Schema.String }))),
});

for (const name of ORDER_EVENTS)
  registerEvent(name, OrderEventSchema, { versioned: true });

/**
 * Who an order event is for: the buyer's party, when the buyer signed in; the
 * organization of the one vendor the order belongs to; and, when the order's
 * checkout group holds a receipt capability, whoever presents it — the
 * anonymous buyer's open receipt, matched by the digest the group keeps and
 * never by the nonce (ADR 0081 §11, ADR 0072). A digest names no one, and an
 * entry without one admits nobody.
 */
export const orderAudience = (
  order: {
    readonly buyerId?: string | undefined;
    readonly vendorId?: string | undefined;
    readonly groupId?: string | undefined;
  },
  receiptDigest?: string,
): AudienceEntry[] => [
  ...(order.buyerId === undefined
    ? []
    : [{ kind: 'party' as const, id: order.buyerId }]),
  ...(order.vendorId === undefined || order.vendorId === ''
    ? []
    : [{ kind: 'organization' as const, id: order.vendorId }]),
  ...(receiptDigest === undefined ||
  receiptDigest === '' ||
  order.groupId === undefined ||
  order.groupId === ''
    ? []
    : [{ kind: 'flow' as const, id: order.groupId, digest: receiptDigest }]),
];

export interface PlacedOrderLine {
  readonly vendorId: string;
  readonly amount: number;
  readonly quantity: number;
  readonly currency: string;
}

export interface PlacedOrder {
  readonly orderId: string;
  /** The one vendor the order belongs to. */
  readonly vendorId: string;
  /** The checkout group it was placed in. */
  readonly groupId: string;
  /** How the buyer pays this vendor: `card`, `cash` or `cod`. */
  readonly paymentMethod: string;
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
      vendorId: order.vendorId,
      groupId: order.groupId,
      paymentMethod: order.paymentMethod,
      // Each line carries its order's vendor, so a reader pricing per line
      // needs no second lookup.
      lines: order.items.map(({ amount, quantity, currency }) => ({
        vendorId: order.vendorId,
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
