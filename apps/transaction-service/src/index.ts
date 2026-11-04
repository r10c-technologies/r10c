/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split every other backend makes, so an e2e `mock` profile can
 * launch the real endpoints in-process against fakes.
 */
import { makeAppLayer } from '@r10c/shells-effect-transaction';

// Exported so the e2e `mock` profile serves the same routes over a fake engine.
export {
  DeliveryDialsTag,
  endpoints,
  policy,
  VendorFactsTag,
} from '@r10c/shells-effect-transaction';

export const SERVICE_NAME = '@r10c/transaction-service';

/**
 * The index `docs/_shared/ports.md` has been holding since ADR 0021 deleted the
 * standalone process, and ADR 0039 named the condition for reclaiming it: *"the
 * first flow with a participant outside marketplace-admin-service"*. Checkout's
 * participants are stock-service (`:3108`) and order-service (`:3105`), so the
 * trigger fired and this is the commit that binds it (#229).
 */
export const DEFAULT_PORT = 3103;

/** The slice's composition, as the service mounts it: replica 0. */
export const AppLayer = makeAppLayer(DEFAULT_PORT);
