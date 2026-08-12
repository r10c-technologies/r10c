/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it — the same split marketplace-admin-service makes, so an e2e `mock` profile
 * can launch the real router in-process against driver fakes rather than
 * re-declaring a stand-in that could drift.
 */
export { AppLayer } from './mongo';
export {
  type InMemoryObservability,
  makeInMemoryObservabilityLayer,
} from './observability';
export { router } from './routes';
export { seedCatalogReference } from './seed';

export const SERVICE_NAME = '@r10c/marketplace-service';

/**
 * The `310N` convention: marketplace is domain index 0.
 *
 * Reclaimed from the deleted health-check shell of the same name. The
 * difference is the one ADR 0020 made sayable — this deployment owns stores
 * (`catalog-reference` and `published-catalog`), and the old one owned none.
 */
export const DEFAULT_PORT = 3100;
