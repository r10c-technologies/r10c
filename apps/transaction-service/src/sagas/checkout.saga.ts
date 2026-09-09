import { defineSaga, type SagaDefinition } from '@r10c/entifix-transactions';

/** The participant keys this coordinator resolves addresses and tokens for. */
export const STOCK_PARTICIPANT = 'stock-service';
export const ORDER_PARTICIPANT = 'order-service';

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
 * ⚠️ **No pivot, deliberately.** Payment capture is the point of no return and
 * it lands in M4; until then every step here reverses, which is a stronger
 * property than a pivot rather than a missing one. Naming the order write as
 * the pivot would satisfy a validator and be wrong in a way that only surfaces
 * later — the real pivot sits *after* it, so it would have to be un-pivoted.
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
  ],
});

/** Every definition this coordinator knows, by name. */
export const SAGAS: Readonly<Record<string, SagaDefinition>> = {
  [checkoutSaga.name]: checkoutSaga,
};
