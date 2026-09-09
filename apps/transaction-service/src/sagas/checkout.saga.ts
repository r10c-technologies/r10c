import { defineSaga, type SagaDefinition } from '@r10c/entifix-transactions';

/** The participant keys this coordinator resolves addresses and tokens for. */
export const STOCK_PARTICIPANT = 'stock-service';
export const ORDER_PARTICIPANT = 'order-service';
export const PAYMENT_PARTICIPANT = 'payment-service';

/**
 * Checkout: hold the stock, then write the order.
 *
 * ⚠️ **This file imports no domain, and that is the point.** An orchestrator
 * that knew checkout's steps as *code* would have to reference
 * `stock-management` and `order-management`, and a `business:domain` package may
 * not import another (`docs/_shared/layering.md`) — there is no legal home for
 * that class. So the flow is **data**, a generic engine walks it, and the
 * constraint that looked like an obstacle is the design
 * ([ADR 0039](../../../../docs/adr/0039-multi-step-sagas-are-orchestrated.md)).
 *
 * ⚠️ **`reserve` fans out; it is not N steps.** A cart's vendor count is known
 * only at runtime, so N steps would mean generating a definition per request —
 * at which point it stops being data and the paragraph above stops being true.
 * One declaration, one call per line, and **one compensation per call that
 * succeeded**: five lines with three holds taken and the fourth refused release
 * exactly three ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * ⚠️ **`capture-payment` is the pivot, and it sits after the order write** —
 * exactly where ADR 0052 said it would when it refused to let the order write be
 * called one. Everything before it reverses; nothing after it does. `runSaga`
 * enforces that rather than merely reading it off the declaration: an
 * unconditional unwind would walk past the capture (which declares no
 * compensation, so compensating it is a no-op) and then delete the order and
 * release the holds behind it, leaving a charged customer with no order and the
 * goods back on sale
 * ([ADR 0054](../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 *
 * ⚠️ **`convert-reservation` is dispatched here rather than driven by
 * `payment.captured` on the bus.** The hold has a TTL measured in minutes and
 * the buyer is waiting, so the conversion belongs on the synchronous path; and
 * it is a crossing into a vendor's tenant store, which only this process holds a
 * token for. order-service consumes `payment.captured` to advance the order's
 * status, which is the part that can safely be late.
 *
 * `defineSaga` runs at module load, so an invalid shape fails the process at
 * boot rather than on the first checkout.
 */
export const checkoutSaga: SagaDefinition = defineSaga({
  name: 'checkout',
  // What a caller must hold to run it. The flow's terminal act is writing an
  // order, so this is the authority actually being exercised — and it is
  // already in `SERVICE_CROSSING_PERMISSIONS`, which is the closed list that
  // keeps fleet membership from being a capability on its own.
  permission: 'order-management:product-order:write',
  steps: [
    {
      id: 'reserve',
      participant: STOCK_PARTICIPANT,
      // ADR 0023's crossing. The organization comes from the *line* — the
      // vendor that owns the offering — because a buyer's session names none
      // and never will.
      command: { method: 'POST', path: '/api/reservation' },
      compensation: {
        method: 'DELETE',
        path: '/api/reservation/{outcome.data.id}',
      },
      kind: 'compensatable',
      fanOut: true,
    },
    {
      id: 'write-order',
      participant: ORDER_PARTICIPANT,
      command: { method: 'POST', path: '/api/product-order' },
      compensation: {
        method: 'DELETE',
        path: '/api/product-order/{outcome.data.id}',
      },
      kind: 'compensatable',
    },
    {
      id: 'capture-payment',
      participant: PAYMENT_PARTICIPANT,
      command: { method: 'POST', path: '/api/payment' },
      // No compensation, and `defineSaga` refuses one on a pivot. A refund is a
      // new record with its own money movement — ADR 0039's "a refund is not an
      // uncharge" — so there is nothing here to undo the charge with.
      kind: 'pivot',
    },
    {
      id: 'convert-reservation',
      participant: STOCK_PARTICIPANT,
      // The hold becomes a sale movement. Fans out for the same reason
      // `reserve` does: a cart's vendor count is known only at runtime, so one
      // conversion per hold taken.
      // ⚠️ `{outcome…}`, and `fanOutFrom: 'reserve'` is what makes it resolvable.
      // stock-service mints the reservation id, so the caller cannot supply it
      // when it starts the flow — this step's cardinality and its addresses both
      // come from the holds that were actually taken.
      command: {
        method: 'POST',
        path: '/api/reservation/{outcome.data.id}/conversion',
      },
      kind: 'retriable',
      fanOut: true,
      fanOutFrom: 'reserve',
    },
  ],
});

/** Every definition this coordinator knows, by name. */
export const SAGAS: Readonly<Record<string, SagaDefinition>> = {
  [checkoutSaga.name]: checkoutSaga,
};
