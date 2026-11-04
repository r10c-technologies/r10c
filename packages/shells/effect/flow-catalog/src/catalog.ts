import type { Recipe } from '@entifix/business/compose';
import {
  defineCatalog,
  flowCommit,
  type SlipAudienceEntry,
  type SlipSegment,
} from '@entifix/business/flow';
import { openStruct } from '@entifix/core';
import { ORDER_FRAGMENTS } from '@r10c/business-ts-order-management';
import { PAYMENT_FRAGMENTS } from '@r10c/business-ts-payment-management';
import {
  OrderTenders,
  SalesChannelTypes,
} from '@r10c/business-ts-sales-vocabulary';
import { FULFILMENT_FRAGMENTS } from '@r10c/business-ts-shipping-order-management';
import { STOCK_FRAGMENTS } from '@r10c/business-ts-stock-management';
import { Schema } from 'effect';

/**
 * Every fragment r10c composes flows from, assembled in the one place allowed
 * to name every domain (ADR 0065). A domain declares its own fragments; this
 * shell only collects them, and a recipe references them by `id@n` string.
 */
export const flowCatalog = defineCatalog([
  ...STOCK_FRAGMENTS,
  ...ORDER_FRAGMENTS,
  ...PAYMENT_FRAGMENTS,
  ...FULFILMENT_FRAGMENTS,
  flowCommit,
]);

/**
 * The tenders a checkout can be composed for — the one set the order, payment
 * and shipping records carry, `cod` included (ADR 0070).
 */
export const PAYMENT_METHODS = OrderTenders;

/** The entitlement a vendor holds to ship what it sells. */
const SHIPPING = 'shipping-order-management';

/** One priced line: the offering, how many, and its unit price. */
const Line = openStruct({
  offeringId: Schema.NonEmptyString,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
  amount: Schema.Number,
  currency: Schema.NonEmptyString,
});
type Line = typeof Line.Type;

/**
 * One vendor's part of a basket: whose lines, how the buyer pays them, and the
 * entitlements the coordinator **verified for that vendor** — never the
 * caller's, and never what the caller sent: the coordinator overwrites them
 * before composing, so a storefront buyer, who holds none, starts a checkout
 * whose vendors do.
 */
const VendorPart = openStruct({
  vendorId: Schema.NonEmptyString,
  paymentMethod: Schema.Literals(PAYMENT_METHODS),
  lines: Schema.Array(Line).check(Schema.isMinLength(1)),
  entitlements: Schema.optionalKey(Schema.Array(Schema.String)),
});
type VendorPart = typeof VendorPart.Type;

/** Where a sale was made: the storefront, or one of a vendor's own channels. */
const Channel = openStruct({
  type: Schema.Literals(SalesChannelTypes),
  id: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

/**
 * What a checkout starts from. `groupId` is the flow's own id, stated by the
 * coordinator (ADR 0069); the digests are the storefront's — one lets a buyer
 * cancel from their receipt, the other lets an anonymous buyer hear the flow.
 */
export const CheckoutStart = openStruct({
  groupId: Schema.NonEmptyString,
  channel: Channel,
  vendors: Schema.Array(VendorPart).check(Schema.isMinLength(1)),
  totals: Schema.Array(
    openStruct({ currency: Schema.NonEmptyString, amount: Schema.Number }),
  ),
  buyerId: Schema.optionalKey(Schema.String),
  cancelDigest: Schema.optionalKey(Schema.String),
  capabilityDigest: Schema.optionalKey(Schema.String),
});
export type CheckoutStart = typeof CheckoutStart.Type;

/** A vendor's lines total: unit price times quantity. */
const totalOf = (lines: readonly Line[]) =>
  lines.reduce((sum, line) => sum + line.amount * line.quantity, 0);

/** The vendor part a segment was expanded for. */
const partOf = (
  vendors: readonly VendorPart[],
  segment: SlipSegment | undefined,
): VendorPart =>
  vendors.find(part => part.vendorId === segment?.vendor) as VendorPart;

/** Money taken at checkout — card online, card or cash at a counter. */
const paysNow = (part: VendorPart) => part.paymentMethod !== 'cod';

const atCounter = (start: CheckoutStart) => start.channel.type !== 'storefront';

const holds = (segment: SlipSegment | undefined, entitlement: string) =>
  segment?.entitlements?.includes(entitlement) === true;

/** One line per offering, keyed by it, for a `perLine` step in its segment. */
const linesOf = (
  lines: readonly { readonly offeringId: string; readonly quantity: number }[],
) =>
  lines.map(line => ({
    key: line.offeringId,
    parameters: { offeringId: line.offeringId, quantity: line.quantity },
  }));

/** Every flow reaches the flow itself, by capability, and the vendors it acts for. */
const audienceOf = (
  flowId: string,
  vendors: readonly string[],
  capabilityDigest: string | undefined,
  buyerId: string | undefined,
): SlipAudienceEntry[] => [
  ...(capabilityDigest === undefined
    ? []
    : [{ kind: 'flow' as const, id: flowId, digest: capabilityDigest }]),
  ...vendors.map(id => ({ kind: 'organization' as const, id })),
  ...(buyerId === undefined ? [] : [{ kind: 'party' as const, id: buyerId }]),
];

/**
 * Checkout (ADR 0069, ADR 0070). Open the buyer's group under the flow's id;
 * per vendor, check a cash-on-delivery seller may take it, hold each line and
 * write that vendor's order; take the money for every vendor paying now in one
 * capture — the pivot — or, for a basket all on delivery, pass `flow.commit`;
 * then per vendor convert its holds and confirm its order, and open its
 * shipment (from the storefront) or hand the goods over (at a counter).
 *
 * Every segment is one vendor, carrying its own tender and the entitlements
 * verified for it, so a mixed basket captures only the card vendors' shares.
 */
export const checkoutRecipe: Recipe<CheckoutStart> = {
  name: 'checkout',
  input: CheckoutStart,
  requiresCommitPoint: true,
  segments: start =>
    start.vendors.map(part => ({
      vendor: part.vendorId,
      paymentMethod: part.paymentMethod,
      entitlements: part.entitlements ?? [],
    })),
  lines: (start, segment) => linesOf(partOf(start.vendors, segment).lines),
  audience: (start, _context, flowId) =>
    audienceOf(
      flowId,
      start.vendors.map(part => part.vendorId),
      start.capabilityDigest,
      start.buyerId,
    ),
  stages: [
    {
      name: 'group',
      steps: [
        {
          ref: 'order.open-group@2',
          parameters: (_context, start) => ({
            id: start.groupId,
            totals: start.totals,
            ...(start.buyerId === undefined ? {} : { buyerId: start.buyerId }),
            ...(start.cancelDigest === undefined
              ? {}
              : { cancelDigest: start.cancelDigest }),
          }),
        },
      ],
    },
    {
      name: 'place',
      perSegment: true,
      steps: [
        {
          ref: 'payment.cod-eligible@1',
          when: (_context, _start, segment) => segment?.paymentMethod === 'cod',
          parameters: (_context, start, segment) => ({
            vendorId: segment?.vendor,
            amount: totalOf(partOf(start.vendors, segment).lines),
          }),
        },
        {
          ref: 'stock.reserve@2',
          parameters: (_context, _start, segment) => ({
            organizationId: segment?.vendor,
          }),
        },
        {
          ref: 'order.write@3',
          parameters: (_context, start, segment) => {
            const part = partOf(start.vendors, segment);
            return {
              vendorId: part.vendorId,
              paymentMethod: part.paymentMethod,
              items: part.lines,
              ...(start.buyerId === undefined
                ? {}
                : { buyerId: start.buyerId }),
              ...(atCounter(start) ? { channel: start.channel } : {}),
            };
          },
        },
      ],
    },
    {
      name: 'pay',
      steps: [
        {
          ref: 'payment.capture@3',
          when: (_context, start) => start.vendors.some(paysNow),
          parameters: (_context, start) => {
            const paying = start.vendors.filter(paysNow);
            return {
              currency: paying[0]?.lines[0]?.currency,
              paymentMethod: paying[0]?.paymentMethod,
              shares: paying.map(part => ({
                vendorId: part.vendorId,
                amount: totalOf(part.lines),
              })),
              ...(start.channel.id === undefined
                ? {}
                : { channelId: start.channel.id }),
            };
          },
        },
        {
          ref: 'flow.commit@1',
          when: (_context, start) => !start.vendors.some(paysNow),
        },
      ],
    },
    {
      name: 'fulfil',
      perSegment: true,
      steps: [
        {
          ref: 'stock.convert@3',
          parameters: (_context, _start, segment) => ({
            organizationId: segment?.vendor,
          }),
        },
        { ref: 'order.confirm@2' },
        {
          ref: 'fulfilment.open@2',
          when: (_context, start, segment) =>
            !atCounter(start) && holds(segment, SHIPPING),
          parameters: (_context, start, segment) => {
            const part = partOf(start.vendors, segment);
            return {
              organizationId: part.vendorId,
              paymentMethod: part.paymentMethod,
              amountDue: part.paymentMethod === 'cod' ? totalOf(part.lines) : 0,
              currency: part.lines[0]?.currency,
              lines: part.lines.map(line => ({
                offeringId: line.offeringId,
                quantity: line.quantity,
              })),
            };
          },
        },
        {
          ref: 'order.mark-dispatched@2',
          when: (_context, start) => atCounter(start),
        },
        {
          ref: 'order.close@2',
          when: (_context, start) => atCounter(start),
          parameters: () => ({ outcome: 'fulfilled' }),
        },
      ],
    },
  ],
};

/** One line a cancellation puts back. */
const ReturnedLine = openStruct({
  offeringId: Schema.NonEmptyString,
  quantity: Schema.Int.check(Schema.isGreaterThan(0)),
});

/**
 * What a cancellation starts from — all of it stated by order-service from the
 * stored order, which is the authority on it: the order, its vendor, how it was
 * paid, the lines to put back, and whether a shipment was opened for it. The
 * vendor's entitlements are the coordinator's to verify, as for a checkout.
 */
export const CancellationStart = openStruct({
  orderId: Schema.NonEmptyString,
  vendorId: Schema.NonEmptyString,
  paymentMethod: Schema.Literals(PAYMENT_METHODS),
  lines: Schema.Array(ReturnedLine).check(Schema.isMinLength(1)),
  shipped: Schema.Boolean,
  entitlements: Schema.optionalKey(Schema.Array(Schema.String)),
  buyerId: Schema.optionalKey(Schema.String),
  capabilityDigest: Schema.optionalKey(Schema.String),
});
export type CancellationStart = typeof CancellationStart.Type;

/** The order's id, and its shipment's — which is the same id (ADR 0070). */
const theOrder = (_context: unknown, start: CancellationStart) => ({
  orderId: start.orderId,
  shippingOrderId: start.orderId,
  organizationId: start.vendorId,
});

/**
 * Cancellation, one vendor order (ADR 0058, ADR 0070): hold its shipment so a
 * dispatch cannot race the cancel, claim the order, give the money back — the
 * pivot — or, for cash on delivery that took none, pass `flow.commit`; then put
 * the goods back, withdraw the shipment and close the order cancelled.
 */
export const cancellationRecipe: Recipe<CancellationStart> = {
  name: 'cancellation',
  input: CancellationStart,
  requiresCommitPoint: true,
  provides: { orderId: Schema.String, shippingOrderId: Schema.String },
  segments: start => [
    {
      vendor: start.vendorId,
      paymentMethod: start.paymentMethod,
      entitlements: start.entitlements ?? [],
    },
  ],
  lines: start => linesOf(start.lines),
  audience: (start, _context, flowId) =>
    audienceOf(flowId, [start.vendorId], start.capabilityDigest, start.buyerId),
  stages: [
    {
      name: 'lock',
      perSegment: true,
      steps: [
        {
          ref: 'fulfilment.hold@2',
          when: (_context, start) => start.shipped,
          parameters: theOrder,
        },
        { ref: 'order.claim-cancel@3', parameters: theOrder },
      ],
    },
    {
      name: 'refund',
      perSegment: true,
      steps: [
        {
          ref: 'payment.refund@2',
          when: (_context, start) => start.paymentMethod !== 'cod',
          parameters: theOrder,
        },
        {
          ref: 'flow.commit@1',
          when: (_context, start) => start.paymentMethod === 'cod',
        },
      ],
    },
    {
      name: 'restore',
      perSegment: true,
      steps: [
        {
          ref: 'stock.restore@3',
          parameters: (_context, start) => ({
            organizationId: start.vendorId,
            cause: 'cancellation',
          }),
        },
        {
          ref: 'fulfilment.withdraw@2',
          when: (_context, start) => start.shipped,
          parameters: theOrder,
        },
        {
          ref: 'order.close@2',
          parameters: (context, start) => ({
            ...theOrder(context, start),
            outcome: 'cancelled',
          }),
        },
      ],
    },
  ],
};

/**
 * What a delivery flow's waits are correlated with: its shipment. The
 * coordinator's `shipping-order.*` consumer signals by it, knowing the
 * shipment a vendor's report names and neither the flow nor its step names.
 */
export const deliveryCorrelation = (shippingOrderId: string) =>
  `delivery:${shippingOrderId}`;

/** A courier's report the delivery flow branches on, past its two waits. */
export const DELIVERY_OUTCOMES = {
  delivered: 'delivered',
  refused: 'refused',
  /** No report inside the delivery window — handled as a refusal. */
  unanswered: 'unanswered',
  returned: 'returned',
} as const;

/** A positive whole number of milliseconds. */
const Millis = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * What a delivery starts from: the shipment as fulfilment-service stored it —
 * the authority on it — and, stated by the coordinator, the vendor's verified
 * entitlements and the two windows, which are configuration rows rather than
 * anything a caller says.
 */
export const DeliveryStart = openStruct({
  shippingOrderId: Schema.NonEmptyString,
  orderId: Schema.NonEmptyString,
  groupId: Schema.NonEmptyString,
  vendorId: Schema.NonEmptyString,
  paymentMethod: Schema.Literals(PAYMENT_METHODS),
  amountDue: Schema.Number,
  currency: Schema.NonEmptyString,
  lines: Schema.Array(ReturnedLine).check(Schema.isMinLength(1)),
  buyerId: Schema.optionalKey(Schema.String),
  entitlements: Schema.optionalKey(Schema.Array(Schema.String)),
  awaitDeliveryMs: Millis,
  awaitReturnMs: Millis,
});
export type DeliveryStart = typeof DeliveryStart.Type;

const theShipment = (_context: unknown, start: DeliveryStart) => ({
  orderId: start.orderId,
  shippingOrderId: start.shippingOrderId,
  organizationId: start.vendorId,
});

const AWAIT_DELIVERY = 'fulfilment.await-delivery';
const AWAIT_RETURN = 'fulfilment.await-return';

/**
 * Delivery, one vendor order (ADR 0070): hand the parcel to the courier — the
 * pivot, after which nothing is undone — and mark the order dispatched; then
 * wait for the courier's report, for as long as the delivery window.
 *
 * - **Delivered**: record the cash a cash-on-delivery courier collected, and
 *   close the order fulfilled.
 * - **Refused, or no report in the window**: wait for the parcel to come
 *   back, put the goods back as a `return`, close the order cancelled, and
 *   give a card buyer their money back. A parcel that never comes back in the
 *   return window strands the flow for a person: nothing here can decide
 *   whether goods that are nowhere go back on the shelf.
 *
 * The refund is a retried step past the dispatch, not a pivot of its own: a
 * slip has one point of no return, and this one already passed it.
 */
export const deliveryRecipe: Recipe<DeliveryStart> = {
  name: 'delivery',
  input: DeliveryStart,
  requiresCommitPoint: true,
  provides: { orderId: Schema.String, shippingOrderId: Schema.String },
  segments: start => [
    {
      vendor: start.vendorId,
      paymentMethod: start.paymentMethod,
      entitlements: start.entitlements ?? [],
    },
  ],
  lines: start => linesOf(start.lines),
  audience: (start, _context, flowId) =>
    audienceOf(flowId, [start.vendorId], undefined, start.buyerId),
  stages: [
    {
      name: 'dispatch',
      perSegment: true,
      steps: [
        { ref: 'fulfilment.dispatch@2', parameters: theShipment },
        { ref: 'order.mark-dispatched@2', parameters: theShipment },
      ],
    },
    {
      name: 'await',
      perSegment: true,
      steps: [
        {
          ref: `${AWAIT_DELIVERY}@3`,
          parameters: (context, start) => ({
            ...theShipment(context, start),
            correlation: deliveryCorrelation(start.shippingOrderId),
            timeoutMs: start.awaitDeliveryMs,
            onTimeout: { outcome: DELIVERY_OUTCOMES.unanswered },
          }),
        },
      ],
    },
    {
      name: 'delivered',
      perSegment: true,
      on: { wait: AWAIT_DELIVERY, outcomes: [DELIVERY_OUTCOMES.delivered] },
      steps: [
        {
          ref: 'payment.record-collection@1',
          when: (_context, start) => start.paymentMethod === 'cod',
          parameters: (_context, start) => ({
            groupId: start.groupId,
            orderId: start.orderId,
            vendorId: start.vendorId,
            amount: start.amountDue,
            currency: start.currency,
          }),
        },
        {
          ref: 'order.close@2',
          // Named apart from the return branch's close: a step's name is its
          // Activity's, and two steps of one slip may not share one.
          step: 'order.close-fulfilled',
          parameters: (context, start) => ({
            ...theShipment(context, start),
            outcome: 'fulfilled',
          }),
        },
      ],
    },
    {
      name: 'returned',
      perSegment: true,
      on: {
        wait: AWAIT_DELIVERY,
        outcomes: [DELIVERY_OUTCOMES.refused, DELIVERY_OUTCOMES.unanswered],
      },
      steps: [
        {
          ref: `${AWAIT_RETURN}@3`,
          parameters: (context, start) => ({
            ...theShipment(context, start),
            correlation: deliveryCorrelation(start.shippingOrderId),
            timeoutMs: start.awaitReturnMs,
            onTimeout: 'strand',
          }),
        },
        {
          ref: 'stock.restore@3',
          parameters: (_context, start) => ({
            organizationId: start.vendorId,
            cause: 'return',
          }),
        },
        {
          ref: 'order.close@2',
          step: 'order.close-cancelled',
          parameters: (context, start) => ({
            ...theShipment(context, start),
            outcome: 'cancelled',
          }),
        },
        {
          ref: 'payment.refund-after-delivery@1',
          when: (_context, start) => start.paymentMethod !== 'cod',
          parameters: theShipment,
        },
      ],
    },
  ],
};

/** Every recipe, by name — what `$metadata` resolves a verb's recipe against. */
export const FLOW_RECIPES = {
  checkout: checkoutRecipe,
  cancellation: cancellationRecipe,
  delivery: deliveryRecipe,
} as const;
