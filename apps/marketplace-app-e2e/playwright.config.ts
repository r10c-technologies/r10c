import { defineEntifixE2eConfig } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * marketplace-app e2e.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * `packages/entifix/ts/testing-e2e/README.md`.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-app',
  port: 3000,
});
