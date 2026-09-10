/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the split every backend here makes, so an e2e `mock` profile can launch
 * the real router in-process against driver fakes rather than re-declaring a
 * stand-in that could drift.
 */
export { AppLayer } from './mongo';
export { router } from './routes';
export { SALES_CHANNEL_COLLECTION } from './sales-channel-index';
export { salesChannelTempData } from './sales-temp-data';
/**
 * Exported so the e2e `mock` profile boots the **real** seed rather than a
 * fixture of its own: both profiles then read the same channels, and a shared
 * journey can name a seeded row instead of asserting that some row exists —
 * which is the assertion that passes against an empty store.
 */
export { seedSales } from './seed';

export const SERVICE_NAME = '@r10c/sales-service';

/**
 * The `310N` convention: sales is domain index 9.
 *
 * [ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)
 * allocated the index long before anything bound it, and it took 9 rather than
 * the then-free 3103 because that one was reserved for the `transaction` slice
 * splitting out of marketplace-admin-service — which it since did. This is the
 * commit that binds 3109.
 */
export const DEFAULT_PORT = 3109;
