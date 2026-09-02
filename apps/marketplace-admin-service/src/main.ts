import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

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
  // Two slices in one process. `transaction` is co-deployed here (ADR 0021):
  // ownership never moved, only the process did, so both are named rather than
  // one standing in for the other.
  slices: ['marketplace-admin', 'transaction'],
  router,
  appLayer: AppLayer,
});
