import { HttpRouter } from '@effect/platform';
import { makeService } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

/**
 * marketplace-service — storefront backend, Effect-native (port 3100).
 *
 * Foundation shell: `/api/health` only, provided by the shared service base.
 * Domain routes + Mongo Layers arrive next iteration; they compose into
 * `router` / `appLayer` without touching this bootstrap.
 */
makeService({
  name: '@r10c/marketplace-service',
  port: Number(process.env.PORT) || 3100,
  router: HttpRouter.empty,
  appLayer: Layer.empty,
});
