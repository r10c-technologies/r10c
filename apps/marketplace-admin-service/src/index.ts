/**
 * The service as a *composable definition*, separate from `main.ts` which boots
 * it. `main.ts` stays the webpack entry point; this barrel is what lets the e2e
 * `mock` profile launch the SAME router in-process against driver fakes, rather
 * than re-declaring a stand-in that could drift from the real route surface.
 */
import { makeAppLayer } from '@r10c/shells-effect-marketplace-admin';

import { seedCatalog } from './seed';

/** The slice's composition, as the service mounts it, with its seed. */
export const AppLayer = makeAppLayer({ seed: seedCatalog });
// Re-exported so the e2e `mock` profile can provide what the real router
// requires without opening its own edge onto `@entifix/transactions`. The
// create route resolves both: the slice it stamps events with, and the relay's
// ceiling.
export { router } from '@r10c/shells-effect-marketplace-admin';
export { seedCatalog };
export { EventSourceTag } from '@entifix/transactions';

export const SERVICE_NAME = '@r10c/marketplace-admin-service';

/** The `310N` convention: marketplace-admin is domain index 1. */
export const DEFAULT_PORT = 3101;
