import { ProductOrder } from '@r10c/business-ts-order-management';
import type { OutboxEntry } from '@r10c/entifix-transactions';
import {
  type DomainEvent,
  envelopeEntityName,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { OUTBOX_COLLECTION } from '@r10c/entifix-ts-mongo-client';
import type { ClientSession, Db } from 'mongodb';

/** Where an order lives. The entity's own key, as every collection name is. */
export const ORDER_COLLECTION = envelopeEntityName(ProductOrder);

/** The slice this process publishes as (ADR 0020's ownership noun). */
export const ORDER_SLICE = 'order';

/**
 * Announce a placed order, **in the caller's transaction**.
 *
 * ⚠️ **This is the whole reason the function takes a session.** ADR 0028's rule:
 * the event is written to the outbox inside the same Mongo transaction as the
 * write it announces. Written separately, a crash between the two leaves an
 * order nobody was told about, or an announcement of an order that rolled back.
 *
 * ⚠️ **The outbox lives in the `order` store, not a control-plane one**, for the
 * reason the catalog's lives in `catalog`: same database keeps the transaction
 * single-database and therefore single-shard, and an outbox holds event
 * payloads — which here is a whole receipt, including what the buyer paid.
 *
 * ⚠️ **`order.placed` still has no consumer, and it is drained anyway.** The
 * payment slice was going to subscribe to it; ADR 0054 settled capture as a saga
 * step instead, so the queue that would have bound this is gone. The entry is
 * written because ADR 0028 requires it, and the relay publishes it because an
 * outbox nothing drains is a backlog with no ceiling and no gauge — which is the
 * defect #232 recorded. Its consumer arrives later.
 */
export const orderPlacedEntry = async (
  db: Db,
  session: ClientSession,
  order: ProductOrder,
): Promise<void> => {
  const at = new Date().toISOString();
  const event: DomainEvent = {
    name: 'order.placed',
    // `<orderId>:placed`, the shape `transactionEventId` uses — one flow emits
    // several messages, so keying on the order id alone would make a later
    // event look like a redelivery of this one.
    id: `${String(order.id)}:placed`,
    source: ORDER_SLICE,
    at,
    correlationId: String(order.id),
    data: serializeEntity(ProductOrder, order),
  };

  const entry: OutboxEntry = {
    eventId: event.id,
    event,
    sent: false,
    // Defaulted here rather than at the write site: an entry missing `attempts`
    // sorts into `pending` and then fails `attempts + 1` arithmetic.
    attempts: 0,
    quarantined: false,
    createdAt: at,
  };

  await db.collection<OutboxEntry>(OUTBOX_COLLECTION).insertOne(entry, {
    session,
  });
};

/**
 * Announce a cancelled order, **in the caller's transaction**.
 *
 * ⚠️ **`order.cancelled` has been declared by this slice since it was written,
 * with nothing emitting it.** This is the emitter, and it lands in the same
 * Mongo transaction as the `cancelled` status for the reason above: an
 * announcement that commits apart from the write it announces is the dual write
 * ADR 0028 exists to close, and retrofitting it later is that same bug arriving
 * on purpose.
 *
 * Its consumer is settlement, which joins it against `payment.refunded` on the
 * order id to reverse a commission entry — neither message alone carries both
 * which vendors and that the money moved
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md) §9).
 *
 * ⚠️ **The payload is the whole order, as `order.placed`'s is.** A consumer
 * reversing a commission needs the vendor-tagged lines, and a message carrying
 * only an id would send it back to a store it cannot open.
 *
 * ⚠️ **It takes the stored document rather than a `ProductOrder`**, which is the
 * one difference from `orderPlacedEntry` above. That function is called with an
 * order it just built in memory and serializes it; this one is called from
 * inside a transaction that has just read the document back, and the document
 * *is* the serialized form. Deserializing it into an entity only to serialize it
 * again would round-trip through an `Effect` that cannot be awaited inside the
 * driver callback, for a value that is already exactly what is wanted.
 */
export const orderCancelledEntry = async (
  db: Db,
  session: ClientSession,
  order: { readonly id: string },
): Promise<void> => {
  const at = new Date().toISOString();
  const event: DomainEvent = {
    name: 'order.cancelled',
    // `<orderId>:cancelled`, distinct from `<orderId>:placed` for the reason
    // that suffix exists: one order emits several messages over its life, and
    // keying on the order id alone would make this look like a redelivery of
    // the placement.
    id: `${order.id}:cancelled`,
    source: ORDER_SLICE,
    at,
    correlationId: order.id,
    // The document as stored, which is the same shape `serializeEntity` answers
    // for `order.placed` — minus Mongo's own `_id`, which the caller projects
    // away and which is not part of any entity.
    data: order as Record<string, unknown>,
  };

  const entry: OutboxEntry = {
    eventId: event.id,
    event,
    sent: false,
    attempts: 0,
    quarantined: false,
    createdAt: at,
  };

  await db.collection<OutboxEntry>(OUTBOX_COLLECTION).insertOne(entry, {
    session,
  });
};
