import { makeService } from '@r10c/shells-effect-service';

import { AppLayer } from './composition';
import { router } from './routes';

/**
 * auth-service — Effect-native auth perimeter (port 3102).
 *
 * No Nest, no legacy decorators: compiled stage-3 like entifix, so it imports
 * entity classes from `@r10c/business-ts-authn` natively. DI is 100% Effect
 * Layers; the shared base owns the HTTP server, `/api/health`, and shutdown.
 */
makeService({
  name: '@r10c/auth-service',
  port: Number(process.env.PORT) || 3102,
  router,
  appLayer: AppLayer,
});
