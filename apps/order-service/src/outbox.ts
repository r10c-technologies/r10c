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
