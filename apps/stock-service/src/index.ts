/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split the other two backends make, so an e2e `mock` profile can
 * launch the real router in-process against driver fakes rather than
 * re-declaring a stand-in that could drift.
 */
export { AppLayer } from './mongo';
export { router } from './routes';

export const SERVICE_NAME = '@r10c/stock-service';

/**
 * The `310N` convention: stock is domain index 8.
 *
 * The index was allocated by [ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)
 * long before anything bound it, so that promoting the slice would be a
 * `deployments` edit rather than a port negotiation. This is the commit that
 * binds it.
 */
export const DEFAULT_PORT = 3108;
