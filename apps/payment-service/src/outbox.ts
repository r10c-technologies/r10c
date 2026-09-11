import {
  paymentCapturedEvent,
  paymentFailedEvent,
  type PaymentOutcome,
  paymentRefundedEvent,
} from '@r10c/business-ts-payment-contracts';
import { Payment, Refund } from '@r10c/business-ts-payment-management';
import { envelopeEntityName } from '@r10c/entifix-ts-core';
import {
  OUTBOX_COLLECTION,
  outboxDocument,
} from '@r10c/entifix-ts-mongo-client';
import type { ClientSession, Db } from 'mongodb';

/** Where a payment lives. The entity's own key, as every collection name is. */
export const PAYMENT_COLLECTION = envelopeEntityName(Payment);

/** Where a refund lives. Its own collection beside the capture, never a flag on it. */
export const REFUND_COLLECTION = envelopeEntityName(Refund);

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

/**
 * Announce money going back, **in the caller's transaction** — same rule as
 * {@link paymentDecidedEntry}, same reason.
 *
 * ⚠️ **Only a refund that happened is announced, and a refused one emits
 * nothing.** The obvious symmetry would be to reuse `payment.failed` the way a
 * refused capture does, and it would be wrong: that name already means *the
 * capture did not happen*, and every note in the fleet about not consuming it —
 * settlement's especially — was written about that meaning. Giving it a second
 * one would make a consumer that later starts reading it silently inherit
 * refund failures it never reasoned about. A refused refund is recorded as a
 * `Refund` row with `status: 'failed'` and answered non-2xx to the caller, which
 * is where the fact belongs
 * ([ADR 0058](../../../docs/adr/0058-the-order-after-payment.md)).
 */
export const refundDecidedEntry = async (
  db: Db,
  session: ClientSession,
  outcome: PaymentOutcome,
  refunded: boolean,
): Promise<void> => {
  if (!refunded) return;

  await db
    .collection(OUTBOX_COLLECTION)
    .insertOne(outboxDocument(paymentRefundedEvent(outcome, PAYMENT_SLICE)), {
      session,
    });
};
