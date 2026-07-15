import { resolve } from 'node:path';

import { makeService } from '@r10c/shells-effect-service';
import { config as loadEnv } from 'dotenv';
import { Layer } from 'effect';

import { router } from './routes';

/**
 * config-service — centralized configuration (port 3190).
 *
 * Configuration is sourced exclusively from environment variables (no db). In
 * development they come from this app's `.env`; in production the real
 * `process.env` is used (dotenv does not override existing values). Frontends
 * resolve their backend URLs through `GET /api/config/:service`.
 */
loadEnv({
  path: resolve(
    process.cwd(),
    process.env.CONFIG_ENV_FILE ?? 'apps/config-service/.env'
  ),
});

makeService({
  name: '@r10c/config-service',
  port: Number(process.env.PORT) || 3190,
  router,
  appLayer: Layer.empty,
});
