/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
export { AppLayer } from './mongo';
export {
  type InMemoryObservability,
  makeInMemoryObservabilityLayer,
} from './observability';
export { router } from './routes';
// The co-deployed `transaction` slice's store, exported so the e2e `mock`
// profile can compose the same layer over a fake pool rather than stubbing the
// routes the catalog's own `202` points at.
export { MongoTransactionStoreLayer, SagaDatabaseName } from './saga/store';
export { seedCatalog } from './seed';

export const SERVICE_NAME = '@r10c/marketplace-admin-service';

/** The `310N` convention: marketplace-admin is domain index 1. */
export const DEFAULT_PORT = 3101;
