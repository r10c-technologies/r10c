import { resolve } from 'node:path';

import { makeService } from '@entifix/service-shell/runtime';
import { makeAppLayer, router } from '@r10c/shells-effect-config';
import { fleetToken } from '@r10c/utils-ts-fleet';
import { config as loadEnv } from 'dotenv';

import { SEED_ROWS } from './db';

/**
 * config-service — centralized configuration (port 3190).
 *
 * Configuration is stored in Postgres (`configuration` table) and served via
 * `GET /api/config/:service`. The connection string comes from `CONFIG_PG_URL`
 * (this app's `.env` in dev; real `process.env` in prod — dotenv does not
 * override existing values). The table is migrated + seeded on first boot.
 */
loadEnv({
  path: resolve(
    process.cwd(),
    process.env.CONFIG_ENV_FILE ?? 'apps/config-service/.env',
  ),
});

makeService({
  name: '@r10c/config-service',
  port: Number(process.env.PORT) || 3190,
  slices: ['config'],
  description: fleetToken,
  router,
  appLayer: makeAppLayer({ seedRows: SEED_ROWS }),
});
