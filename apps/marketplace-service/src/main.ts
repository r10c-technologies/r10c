import { makeService } from '@r10c/shells-effect-service';

import { AppLayer, DEFAULT_PORT, router, SERVICE_NAME } from './index';

/**
 * marketplace-service — storefront backend, Effect-native (port 3100).
 *
 * Foundation shell: `/api/health` only, provided by the shared service base.
 * Domain routes + Mongo Layers arrive next iteration; they compose into
 * `router` / `appLayer` (see `./index`) without touching this bootstrap.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  router,
  appLayer: AppLayer,
});
