import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import express from 'express';
import { readConfigurationFromProcess } from '@r10c/entifix-ts-core';

/**
 * Centralized configuration service.
 *
 * Configuration is sourced exclusively from environment variables (no database).
 * In development the variables are loaded from this app's `.env` file; in
 * production real environment variables already present on `process.env` are used
 * (dotenv does not override existing values).
 *
 * Variable names encode `SERVICE__GROUP__KEY=value`. A request for a given
 * service receives only its variables, with the `SERVICE__` prefix stripped, then
 * grouped into `ConfigurationPlain` by `readConfigurationFromProcess`.
 */
loadEnv({
  path: resolve(
    process.cwd(),
    process.env.CONFIG_ENV_FILE ?? 'apps/marketplace-config-api/.env'
  ),
});

const app = express();

app.get('/api/config/:service', (req, res) => {
  const { service } = req.params;
  const prefix = `${service}__`;

  const scoped: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && name.startsWith(prefix)) {
      // strip "SERVICE__" leaving "GROUP__KEY"
      scoped[name.slice(prefix.length)] = value;
    }
  }

  res.json(readConfigurationFromProcess(scoped));
});

const port = process.env.PORT || 3334;
const server = app.listen(port, () => {
  console.log(`marketplace-config-api listening at http://localhost:${port}`);
});
server.on('error', console.error);
