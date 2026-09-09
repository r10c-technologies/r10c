import {
  paymentCapturedEvent,
  paymentFailedEvent,
  type PaymentOutcome,
} from '@r10c/business-ts-payment-contracts';
import { Payment } from '@r10c/business-ts-payment-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';
import {
  OUTBOX_COLLECTION,
  outboxDocument,
} from '@r10c/entifix-ts-mongo-client';
import type { ClientSession, Db } from 'mongodb';

/** Where a payment lives. The entity's own key, as every collection name is. */
export const PAYMENT_COLLECTION = envelopeEntityName(Payment);

/** The slice this process publishes as (ADR 0020's ownership noun). */
export const PAYMENT_SLICE = 'payment';

/**
 * Announce a decided payment, **in the caller's transaction**.
 *
 * ⚠️ **This is the whole reason the function takes a session.** ADR 0028's rule:
 * the event is written to the outbox inside the same Mongo transaction as the
 * write it announces. Written separately, a crash between the two leaves money
 * taken that nobody was told about — and here that is not a stale projection, it
 * is a vendor who never gets paid and a reservation that expires under a buyer
 * who was charged.
 *
 * ⚠️ **The outbox lives in the `payment` store**, for the reason the catalog's
 * lives in `catalog` and the order's in `order`: same database keeps the
 * transaction single-database and therefore single-shard, and an outbox holds
 * event payloads — which here is an amount and a provider reference.
 *
 * Both names go through one function because they are one decision with two
 * outcomes. `payment.captured` has a consumer today (order-service advances the
 * order) and `payment.failed` does not — the saga compensates a refusal
 * synchronously rather than waiting to be told about it — and neither fact
 * belongs at the write site.
 */
export const paymentDecidedEntry = async (
  db: Db,
  session: ClientSession,
  outcome: PaymentOutcome,
  captured: boolean,
): Promise<void> => {
  const event = captured
    ? paymentCapturedEvent(outcome, PAYMENT_SLICE)
    : paymentFailedEvent(outcome, PAYMENT_SLICE);

  await db
    .collection(OUTBOX_COLLECTION)
    .insertOne(outboxDocument(event), { session });
};
