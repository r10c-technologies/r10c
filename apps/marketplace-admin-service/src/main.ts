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
  router,
  appLayer: AppLayer,
});
