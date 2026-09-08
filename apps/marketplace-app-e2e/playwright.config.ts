import { defineEntifixE2eConfig } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * marketplace-app e2e.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * `packages/entifix/ts/testing-e2e/README.md`.
 *
 * ⚠️ The one thing this suite cannot take from the preset is how the server is
 * started. The storefront reads marketplace-service from **server components**,
 * so the `page.route()` interception every other suite relies on never sees the
 * traffic — the fetch happens in the Next process, not the browser. The `mock`
 * profile therefore starts that process under a preload that installs msw
 * inside it (`src/support/server-mocks.mjs`).
 *
 * ⚠️ `node --import` on Next's own binary, **not** `NODE_OPTIONS` with
 * `pnpm exec`. `NODE_OPTIONS` reaches every node process in the chain — pnpm
 * included — and the resolver hook the preload installs then runs while pnpm is
 * still loading its own configuration, which fails the launch before Next is
 * ever reached. Both paths are relative to `cwd`, which the preset sets to the
 * app's directory.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-app',
  port: 3000,
  mockServerCommand:
    'node --import ../marketplace-app-e2e/src/support/server-mocks.mjs ./node_modules/next/dist/bin/next start -p 3000',
});
