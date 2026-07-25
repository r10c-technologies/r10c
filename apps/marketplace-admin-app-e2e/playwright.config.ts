import { defineEntifixE2eConfig } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * marketplace-admin-app e2e.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * `packages/entifix/ts/testing-e2e/README.md`.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-admin-app',
  port: 3001,
  // The app is behind the auth middleware, so a probe against `/` redirects to
  // an auth-app that is not running here. `/api/health` is exempt and depends on
  // nothing.
  readyPath: '/api/health',
});
