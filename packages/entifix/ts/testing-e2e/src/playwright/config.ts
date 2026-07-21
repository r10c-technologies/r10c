import { join } from 'node:path';

import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';

import { isMockProfile, resolveE2eProfile } from '../profile/profile';

export interface EntifixE2eConfigOptions {
  /** The playwright config file — pass `__filename`, as the Nx preset wants. */
  configFile: string;
  /**
   * The app's directory, relative to the workspace root, e.g.
   * `apps/marketplace-admin-app`. The server is started from there.
   */
  appDir: string;
  /** The port that app serves on (the `300N` convention). */
  port: number;
  /** Spec directory, relative to the config file. */
  testDir?: string;
  /** Anything else to merge in, for a project with a genuine special case. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Every browser Playwright can drive, used by the `live` profile.
 *
 * `mock` runs chromium only, on purpose: interception happens through
 * `page.route()`, which behaves the same everywhere, so the other two engines
 * would triple the pull-request time to re-assert identical wire traffic.
 * Cross-browser rendering differences are a `live` concern.
 */
const ALL_BROWSERS = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

const CHROMIUM_ONLY = ALL_BROWSERS.slice(0, 1);

/**
 * The shared Playwright configuration for an entifix app e2e project.
 *
 * The profile decides three things, and specs decide none of them:
 *
 * - **which specs run** — by filename (`*.mock.spec.ts` / `*.live.spec.ts`).
 *   Selection by `testIgnore` rather than by an in-spec `test.skip` means a
 *   run with the wrong environment fails instead of quietly reporting green.
 * - **which browsers run** — chromium in `mock`, all three in `live`.
 * - **the base URL** — the local app in `mock`; in `live` the app is expected
 *   to already be running (started with its real backend), so Playwright
 *   reuses it rather than racing a second one.
 */
export const defineEntifixE2eConfig = ({
  configFile,
  appDir,
  port,
  testDir = './src',
  overrides = {},
}: EntifixE2eConfigOptions): PlaywrightTestConfig => {
  const mock = isMockProfile();
  const baseURL = process.env['BASE_URL'] ?? `http://localhost:${port}`;

  return defineConfig({
    ...nxE2EPreset(configFile, { testDir }),
    // The other profile's specs are not skipped, they are not collected: a
    // spec that cannot run here has nothing to say about this run.
    testIgnore: mock ? '**/*.live.spec.ts' : '**/*.mock.spec.ts',
    use: {
      baseURL,
      trace: 'on-first-retry',
    },
    // Playwright starts the server itself, with `next start` rather than
    // `nx run <app>:start`. An nx invocation here is inferred by
    // `@nx/playwright/plugin` as a *continuous task dependency* of `e2e`, and
    // the run then waits on a server that never signals completion — the e2e
    // task never starts. The build the server needs is expressed instead as a
    // plain `dependsOn` on the e2e target.
    webServer: {
      command: `pnpm exec next start -p ${port}`,
      cwd: join(workspaceRoot, appDir),
      url: baseURL,
      reuseExistingServer: true,
    },
    projects: mock ? CHROMIUM_ONLY : ALL_BROWSERS,
    ...overrides,
  });
};

export { resolveE2eProfile };
