import type { SagaDefinition } from '@r10c/entifix-transactions';

import { cancellationSaga } from './cancellation.saga';
import { checkoutSaga } from './checkout.saga';

export { cancellationSaga } from './cancellation.saga';
export {
  ORDER_PARTICIPANT,
  PAYMENT_PARTICIPANT,
  STOCK_PARTICIPANT,
} from './checkout.saga';
export { checkoutSaga } from './checkout.saga';

/**
 * Every definition this coordinator knows, by name.
 *
 * ⚠️ **A module of its own, rather than a constant at the bottom of whichever
 * definition happened to be written first.** It used to live in
 * `checkout.saga.ts`, which made every importer of the registry an importer of
 * one flow — and made adding a second one look like editing the first.
 *
 * ⚠️ **Registering a definition here is what makes it resumable.** The resume
 * sweep looks an instance's `definition` name up in this map and logs an error
 * rather than resuming when it finds nothing, so a flow served by
 * `POST /api/saga/:definition` but missing here would run once and never be
 * finished if its coordinator died
 * ([ADR 0055](../../../../docs/adr/0055-a-coordinator-resumes-from-its-own-record.md)).
 */
export const SAGAS: Readonly<Record<string, SagaDefinition>> = {
  [checkoutSaga.name]: checkoutSaga,
  [cancellationSaga.name]: cancellationSaga,
};
