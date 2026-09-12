import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

/**
 * What settlement reads off an `order.placed` message.
 *
 * ⚠️ **A decoder here rather than an import of `ProductOrder`.** The message
 * carries `serializeEntity(ProductOrder, order)` — the whole entity — and an app
 * *may* legally import `order-management` to rebuild it. It does not, for the
 * reason `payment-contracts` exists: a consumer that imports the producer's
 * entity class is pinned to every member the producer ever adds, and settlement
 * needs five fields out of an order.
 *
 * The failure mode of a hand-written reader is normally that the two drift
 * silently, which is what ADR 0049 recorded as the reason to build a contracts
 * package rather than copy a shape. It does not apply here, and the asymmetry is
 * worth stating: a member **added** to `ProductOrder` is a member this decoder
 * ignores, and a member **removed** is a payload this decoder rejects — which
 * classifies the message poison and quarantines it loudly (ADR 0030). Nothing
 * fails quietly in either direction, so a copied shape costs nothing a contract
 * would buy back.
 *
 * The alternative was making order-service publish a purpose-built payload
 * instead of its entity. That is a change to a slice this work does not touch,
 * and ADR 0054 fixed `order.placed` as it stands.
 */
export interface PlacedOrderLine {
  /** The vendor that owes this line. The member the fold groups by. */
  readonly vendorId: string;
  /** Minor units, **per unit** — the line total is this times the quantity. */
  readonly amount: number;
  readonly quantity: number;
  readonly currency: string;
}

export interface PlacedOrder {
  readonly orderId: string;
  readonly lines: readonly PlacedOrderLine[];
  /**
   * The channel type the sale came through, when there was one.
   *
   * Absent for a storefront checkout, present for a counter sale. It is what
   * `Agreement.commissionFor` prices the line by, and it is on the **order**
   * rather than on each line — one sale comes through one channel.
   *
   * ⚠️ **The type, not the id.** `payment.captured` carries a `channelId`, which
   * is a pointer into a tenant store this service cannot open. The type travels
   * on the order as a denormalized copy precisely so a platform-plane reader can
   * use it without a tenant handle (ADR 0024).
   */
  readonly channelType?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readLine = (value: unknown, index: number): PlacedOrderLine => {
  if (!isRecord(value)) {
    throw new EntifixBuildError(`order.placed item ${index} is not an object`);
  }
  const { vendorId, amount, quantity, currency } = value;
  if (typeof vendorId !== 'string' || vendorId === '') {
    throw new EntifixBuildError(`order.placed item ${index} has no vendorId`);
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new EntifixBuildError(
      `order.placed item ${index} has no numeric amount`,
    );
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) {
    throw new EntifixBuildError(
      `order.placed item ${index} has no numeric quantity`,
    );
  }
  if (typeof currency !== 'string' || currency === '') {
    throw new EntifixBuildError(`order.placed item ${index} has no currency`);
  }
  return { vendorId, amount, quantity, currency };
};

/**
 * Decode an `order.placed` payload, or fail.
 *
 * ⚠️ **Failure classifies the message poison, and that is the intent.** A
 * payload this cannot read is one no retry will fix, so `AmqpEventBusLayer`
 * quarantines it with zero attempts rather than spending the delivery budget of
 * every message behind it. Casting instead would turn the same message into a
 * handler failure, requeued five times, and then quarantined anyway — five
 * attempts later and with the queue held up (ADR 0030).
 *
 * ⚠️ **An order with no items is refused.** order-service already rejects one at
 * the door, so a zero-line order on the bus is a corrupted payload rather than a
 * legitimate free sale — and folding it would write a join record that can never
 * complete.
 */
export const readPlacedOrder = (
  data: unknown,
): Effect.Effect<PlacedOrder, EntifixBuildError> =>
  Effect.try({
    try: () => {
      if (!isRecord(data)) {
        throw new EntifixBuildError('order.placed payload is not an object');
      }
      const { id, items, channel } = data;
      if (typeof id !== 'string' || id === '') {
        throw new EntifixBuildError('order.placed payload has no id');
      }
      if (!Array.isArray(items) || items.length === 0) {
        throw new EntifixBuildError('order.placed payload has no items');
      }

      // Absent is normal — a storefront sale comes through no channel at all —
      // so only a *malformed* channel is an error. A channel object whose `type`
      // is missing is malformed: it says a channel exists and refuses to say
      // which, and pricing it as though there were none would quietly charge the
      // default rate.
      let channelType: string | undefined;
      if (channel !== undefined && channel !== null) {
        if (!isRecord(channel) || typeof channel.type !== 'string') {
          throw new EntifixBuildError('order.placed channel has no type');
        }
        channelType = channel.type;
      }

      return {
        orderId: id,
        lines: items.map(readLine),
        ...(channelType === undefined ? {} : { channelType }),
      } satisfies PlacedOrder;
    },
    catch: error =>
      error instanceof EntifixBuildError
        ? error
        : new EntifixBuildError(String(error)),
  });

/**
 * Decode an `order.cancelled` payload, or fail.
 *
 * The same reader under a second name, because it is the same payload: both
 * events carry the whole serialized `ProductOrder`, and order-service says so
 * explicitly — a message carrying only an id "would send a consumer reversing a
 * commission back to a store it cannot open."
 *
 * ⚠️ **The reversal needs only the order id off it**, and reads the amounts back
 * from its own ledger instead. Decoding the whole payload anyway is not waste:
 * it is what classifies a malformed message poison and quarantines it loudly
 * (ADR 0030), rather than acking a shape nobody looked at. An alias rather than
 * a copy so there is one reader to keep true, and one place a removed member
 * shows up.
 */
export const readCancelledOrder = readPlacedOrder;
