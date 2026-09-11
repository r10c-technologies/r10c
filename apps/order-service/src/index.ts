/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split every other backend makes, so an e2e `mock` profile can
 * launch the real router in-process against driver fakes.
 */
export {
  type CancellableOrder,
  type CancelRefusal,
  CancelWindowSeconds,
  digestOf,
  verifyCancelCapability,
} from './cancel-capability';
export {
  CancellationCoordinatorUrl,
  CancellationCrossingToken,
} from './coordinator-config';
export { AppLayer } from './mongo';
export { ORDER_COLLECTION, ORDER_SLICE } from './outbox';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/order-service';

/**
 * The `310N` convention: order is domain index 5.
 *
 * Allocated by [ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)
 * long before anything bound it, so that promoting the slice would be a
 * `deployments` edit rather than a port negotiation. This is the commit that
 * binds it.
 */
export const DEFAULT_PORT = 3105;
