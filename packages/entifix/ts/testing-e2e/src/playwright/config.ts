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
   * `apps/back-office-app`. The server is started from there.
   */
  appDir: string;
  /** The port that app serves on (the `300N` convention). */
  port: number;
  /** Spec directory, relative to the config file. */
  testDir?: string;
  /**
   * Path Playwright polls to decide the server is up, relative to the base URL.
   *
   * A gated app needs one, and it must be **exempt from the auth middleware and
   * free of backend dependencies**: a cold probe against `/` gets a redirect to
   * a sign-in origin that is not running, and one against `/api/config` gets a
   * 500 until config-service is up. Either way the run dies on `Timed out
   * waiting for config.webServer` before a single spec starts. Defaults to the
   * base URL, which is right for an app with no gate.
   */
  readyPath?: string;
  /** Anything else to merge in, for a project with a genuine special case. */
  overrides?: PlaywrightTestConfig;
}

/**
 * Every browser Playwright can drive.
 *
 * Chromium is the default in **both** profiles. Interception happens through
 * `page.route()`, which behaves the same everywhere, so `mock` would triple the
 * pull-request time to re-assert identical wire traffic; and a normal dev
 * machine has only chromium installed, so a `live` run that insisted on all
 * three failed on a missing engine rather than on the code. Cross-browser
 * rendering is worth checking deliberately, not on every run.
 */
const ALL_BROWSERS = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
];

const CHROMIUM_ONLY = ALL_BROWSERS.slice(0, 1);

/** Opts into firefox and webkit; needs `pnpm exec playwright install` first. */
const ALL_BROWSERS_VAR = 'E2E_BROWSERS';

/**
 * The shared Playwright configuration for an entifix app e2e project.
 *
 * The profile decides three things, and specs decide none of them:
 *
 * - **which specs run** — by filename (`*.mock.spec.ts` / `*.live.spec.ts`).
 *   Selection by `testIgnore` rather than by an in-spec `test.skip` means a
 *   run with the wrong environment fails instead of quietly reporting green.
 * - **the base URL** — the local app in `mock`; in `live` the app is expected
 *   to already be running (started with its real backend), so Playwright
 *   reuses it rather than racing a second one.
 * - **whether a reused server is acceptable** — `mock` refuses a development
 *   one, `live` accepts whatever is there. Enforced by an auto fixture in
 *   `defineEntifixE2eTest`, not from here: Playwright loads `globalSetup`
 *   through a different module path than the one it uses for the config and the
 *   specs, and this package is `"type": "module"` while an app's
 *   `playwright.config.ts` is CJS — a file reached both ways transpiles for one
 *   and fails for the other. See `assertExpectedServer`.
 *
 * Browsers are chromium in both profiles unless `E2E_BROWSERS=all`.
 */
export const defineEntifixE2eConfig = ({
  configFile,
  appDir,
  port,
  testDir = './src',
  readyPath = '',
  overrides = {},
}: EntifixE2eConfigOptions): PlaywrightTestConfig => {
  const mock = isMockProfile();
  const baseURL = process.env['BASE_URL'] ?? `http://localhost:${port}`;

  return defineConfig({
    ...nxE2EPreset(configFile, { testDir }),
    // The other profile's specs are not skipped, they are not collected: a
    // spec that cannot run here has nothing to say about this run.
    testIgnore: mock ? '**/*.live.spec.ts' : '**/*.mock.spec.ts',
    // `live` pays for a real sign-in before its first assertion: `seedSession`
    // drives the provider's hosted login for real — three page loads across two
    // origins, each a Next app that hydrates before it will accept a keystroke.
    // Playwright's 30s default is spent on the fixture alone, and the failure it
    // produces points at whatever action was in flight rather than at the clock.
    // `mock` keeps the default: it fabricates the cookie and never leaves the app.
    ...(mock ? {} : { timeout: 90_000 }),
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
      url: `${baseURL}${readyPath}`,
      reuseExistingServer: true,
    },
    projects:
      process.env[ALL_BROWSERS_VAR] === 'all' ? ALL_BROWSERS : CHROMIUM_ONLY,
    ...overrides,
  });
};

export { resolveE2eProfile };
