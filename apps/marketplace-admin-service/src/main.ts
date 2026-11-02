import { makeService } from '@entifix/service-shell/runtime';
import {
  endpoints,
  makeAppLayer,
  policy,
} from '@r10c/shells-effect-marketplace-admin';
import { fleetToken } from '@r10c/utils-ts-fleet';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { seedCatalog } from './seed';

/**
 * marketplace-admin-service — admin catalog backend, Effect-native (port 3101).
 *
 * Serves the catalog (product / brand / category) from MongoDB through the
 * entifix use-cases. Mongo connection settings are resolved from config-service
 * at boot; collections are seeded on first run. The route surface is unchanged
 * so the admin app is unaffected.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  // One slice: `transaction` was co-deployed here until it took `:3103` (#229).
  slices: ['marketplace-admin'],
  description: fleetToken,
  endpoints,
  policy,
  appLayer: makeAppLayer({ seed: seedCatalog }),
});
