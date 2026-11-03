/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — so an e2e `mock` profile can launch the real endpoints in-process
 * against driver fakes rather than re-declaring a stand-in that could drift.
 */
import { makeAppLayer } from '@r10c/shells-effect-fulfilment';

export {
  endpoints,
  FULFILMENT_SLICE,
  policy,
} from '@r10c/shells-effect-fulfilment';

/** The slice's composition, as the service mounts it. */
export const AppLayer = makeAppLayer();

export const SERVICE_NAME = '@r10c/fulfilment-service';

/**
 * The `310N` convention: fulfilment is domain index 10, reserved by ADR 0070
 * so that promoting the slice would be a `deployments` edit rather than a port
 * negotiation. This is the commit that binds it.
 */
export const DEFAULT_PORT = 3110;
