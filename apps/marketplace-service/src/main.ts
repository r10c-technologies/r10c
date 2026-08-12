import { makeService } from '@r10c/shells-effect-service';

import { DEFAULT_PORT, SERVICE_NAME } from './index';
import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * marketplace-service — the storefront's platform-plane read host (port 3100).
 *
 * Owns two stores: `catalog-reference` (operator-authored brands, categories and
 * dictionary terms) and `published-catalog` (the projection of every vendor's
 * approved offerings). Reads are anonymous by design; writes are
 * permission-gated. Mongo settings resolve from config-service at boot.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  router,
  appLayer: AppLayer,
});
