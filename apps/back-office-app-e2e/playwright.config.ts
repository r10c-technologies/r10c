import { defineEntifixE2eConfig } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * back-office-app e2e — catalog, system management, users and the account
 * surface, all on one origin now.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * `packages/entifix/ts/testing-e2e/README.md`.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/back-office-app',
  port: 3001,
  // Everything but the front door is behind the auth middleware, and `/` itself
  // renders the sign-in card rather than a ready page. `/api/health` is exempt
  // from the matcher and depends on nothing.
  readyPath: '/api/health',
});
