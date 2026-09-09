/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split every other backend makes, so an e2e `mock` profile can
 * launch the real router in-process against driver fakes.
 */
export { AppLayer } from './mongo';
export { router } from './routes';
export { checkoutSaga, SAGAS } from './sagas/checkout.saga';

export const SERVICE_NAME = '@r10c/transaction-service';

/**
 * The index `docs/_shared/ports.md` has been holding since ADR 0021 deleted the
 * standalone process, and ADR 0039 named the condition for reclaiming it: *"the
 * first flow with a participant outside marketplace-admin-service"*. Checkout's
 * participants are stock-service (`:3108`) and order-service (`:3105`), so the
 * trigger fired and this is the commit that binds it (#229).
 */
export const DEFAULT_PORT = 3103;
