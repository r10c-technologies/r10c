/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split every other backend makes, so an e2e `mock` profile can
 * launch the real router in-process against driver fakes.
 */
import { makeAppLayer } from '@r10c/shells-effect-transaction';

// Exported so the e2e `mock` profile composes the same layers over a fake pool
// rather than stubbing the routes the catalog's own `202` points at.
export {
  cancellationSaga,
  checkoutSaga,
  HttpSagaDispatcherLayer,
  ParticipantsTag,
  router,
  SAGAS,
  sagaStoresLayer,
} from '@r10c/shells-effect-transaction';

/** The slice's composition, as the service mounts it. */
export const AppLayer = makeAppLayer();

export const SERVICE_NAME = '@r10c/transaction-service';

/**
 * The index `docs/_shared/ports.md` has been holding since ADR 0021 deleted the
 * standalone process, and ADR 0039 named the condition for reclaiming it: *"the
 * first flow with a participant outside marketplace-admin-service"*. Checkout's
 * participants are stock-service (`:3108`) and order-service (`:3105`), so the
 * trigger fired and this is the commit that binds it (#229).
 */
export const DEFAULT_PORT = 3103;
