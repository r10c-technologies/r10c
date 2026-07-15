import { makeService } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { router } from './routes';

/**
 * marketplace-admin-service — admin catalog backend, Effect-native (port 3101).
 *
 * Foundation shell: serves seed catalog data (product / brand / category) so
 * the admin app keeps working; Mongo Layers replace the in-memory arrays next
 * iteration without changing the route surface.
 */
makeService({
  name: '@r10c/marketplace-admin-service',
  port: Number(process.env.PORT) || 3101,
  router,
  appLayer: Layer.empty,
});
