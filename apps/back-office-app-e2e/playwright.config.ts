import { join } from 'node:path';

import { isMockProfile } from '@entifix/testing-e2e';
import { defineEntifixE2eConfig } from '@entifix/testing-e2e/playwright';
import { workspaceRoot } from '@nx/devkit';

const READY_PATH = '/api/health';

/**
 * The `mock` profile's stand-in for auth-service's `/api/me`, the one call the
 * back office makes from its **server** (`src/support/fake-auth-service.mjs`).
 * Its own port, so `reuseExistingServer` never picks up a dev fleet's real
 * auth-service on `3102` instead.
 */
const FAKE_AUTH_PORT = 39102;
const mock = isMockProfile();

/**
 * back-office-app e2e — catalog, system management, users and the account
 * surface, all on one origin now.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * the `@entifix/testing-e2e` README.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/back-office-app',
  port: 3001,
  // Everything but the front door is behind the auth proxy, and `/` itself
  // renders the sign-in card rather than a ready page. `/api/health` is exempt
  // from the matcher and depends on nothing.
  readyPath: READY_PATH,
  overrides: {
    // ⚠️ Two servers, replacing the preset's one: the browser reaches the app
    // through the edge on :3001, and Next listens behind it on :3201 (ADR
    // 0072). The edge is probed through to Next, so "ready" means the whole
    // path answers rather than just Envoy's socket.
    webServer: [
      {
        command: 'pnpm exec next start -p 3201',
        cwd: join(workspaceRoot, 'apps/back-office-app'),
        url: `http://localhost:3201${READY_PATH}`,
        reuseExistingServer: true,
        ...(mock
          ? { env: { AUTH_SERVICE_URL: `http://localhost:${FAKE_AUTH_PORT}` } }
          : {}),
      },
      {
        command: 'bash tools/edge/serve.sh',
        cwd: workspaceRoot,
        url: `http://localhost:3001${READY_PATH}`,
        reuseExistingServer: true,
      },
      ...(mock
        ? [
            {
              command: 'node src/support/fake-auth-service.mjs',
              cwd: __dirname,
              url: `http://localhost:${FAKE_AUTH_PORT}/api/health/live`,
              reuseExistingServer: true,
              env: { FAKE_AUTH_PORT: String(FAKE_AUTH_PORT) },
            },
          ]
        : []),
    ],
  },
});
