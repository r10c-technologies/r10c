import { defineSaga, type SagaDefinition } from '@r10c/entifix-transactions';

import {
  ORDER_PARTICIPANT,
  PAYMENT_PARTICIPANT,
  STOCK_PARTICIPANT,
} from './checkout.saga';

/**
 * Cancellation: claim the order, send the money back, put the goods back, close
 * the record.
 *
 * ⚠️ **This is the second flow ADR 0052 named as the trigger to reconsider the
 * grammar, and the answer is that the grammar held.** That record listed "a saga
 * that fans out across steps rather than within one" among what it did not
 * build, and said a second flow was the condition for revisiting it. This flow
 * is sequential with one fan-out, which `defineSaga` already expresses — so the
 * question was asked and the answer is recorded here rather than skipped
 * ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §7).
 *
 * ⚠️ **`claim` is a step, not a formality.** The conditional write
 * `paid → cancelling` in order-service is what stops two cancellations running
 * at once: the second one matches no document, refuses, and this flow
 * compensates it — so exactly one refund is ever dispatched. A saga's command id
 * is stable across attempts of **one** flow and therefore says nothing about
 * two, which is why it cannot do this job. It is the *semantic lock* the saga
 * literature names for exactly this: a compensatable step marks the record so a
 * second flow can see the first one holding it.
 *
 * ⚠️ **`refund` is the pivot, and it sits as late as it can.** Everything before
 * it reverses and nothing after it does, which is the ordering rule the pattern
 * turns on. A refund has no compensation — un-refunding is charging a customer
 * again — and `defineSaga` refuses one on a pivot rather than letting a false
 * assurance sit in the declaration.
 *
 * ⚠️ **`restore-stock` fans out over the caller's own inputs, not
 * `fanOutFrom`.** Nothing an earlier step created has to be addressed here: by
 * the time an order is `paid` the hold is spent, its sale movement is written,
 * and putting the goods back is a *new* `+quantity` movement rather than an
 * un-conversion. The entry route already holds the lines, and each line's
 * `vendorId` is the `x-organization-id` the crossing needs
 * ([ADR 0010](../../../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * ⚠️ **The flow is started by order-service, which is also its first and last
 * participant.** The cycle is deliberate: a cancellation's authority is a
 * buyer's capability or a vendor's session, and neither is verifiable anywhere
 * but where the order lives (ADR 0058 §6).
 *
 * `defineSaga` runs at module load, so an invalid shape fails the process at
 * boot rather than on the first cancellation.
 */
export const cancellationSaga: SagaDefinition = defineSaga({
  name: 'cancellation',
  // What a caller must hold to run it. Every step that writes here writes the
  // order, so this is the authority actually being exercised — and it is
  // already in `SERVICE_CROSSING_PERMISSIONS`, which is the closed list that
  // keeps fleet membership from being a capability on its own. It is
  // deliberately **not** `product-order:cancel`: that verb is a *person's*
  // authority to ask for a cancellation, checked against a session by
  // order-service, and a crossing entry of the same name would be one string
  // meaning two different things in two tables.
  permission: 'order-management:product-order:write',
  steps: [
    {
      id: 'claim',
      participant: ORDER_PARTICIPANT,
      command: {
        method: 'POST',
        path: '/api/product-order/{input.orderId}/cancelling',
      },
      // ⚠️ `{outcome.data.id}` rather than `{input.orderId}`, and it has to be:
      // a compensation's template resolves against its own call's response body
      // and nothing else — no inputs, no earlier steps. That is why the claim
      // answers the whole order envelope.
      compensation: {
        method: 'DELETE',
        path: '/api/product-order/{outcome.data.id}/cancelling',
      },
      kind: 'compensatable',
    },
    {
      id: 'refund',
      participant: PAYMENT_PARTICIPANT,
      // Addressed by **order id**: this flow holds an order and has never seen
      // a payment. payment-service resolves the capture itself and copies the
      // amount off it, because a body that can name its own amount can refund
      // more than was ever charged
      // ([ADR 0058](../../../../docs/adr/0058-the-order-after-payment.md) §8).
      command: { method: 'POST', path: '/api/refund' },
      kind: 'pivot',
    },
    {
      id: 'restore-stock',
      participant: STOCK_PARTICIPANT,
      command: { method: 'POST', path: '/api/stock-restoration' },
      kind: 'retriable',
      fanOut: true,
    },
    {
      id: 'settle',
      participant: ORDER_PARTICIPANT,
      // Writes `cancelled` and the `order.cancelled` outbox entry in one Mongo
      // transaction — the emitter `order.slice.ts` has declared since the slice
      // was written.
      command: {
        method: 'POST',
        path: '/api/product-order/{input.orderId}/cancelled',
      },
      kind: 'retriable',
    },
  ],
});
