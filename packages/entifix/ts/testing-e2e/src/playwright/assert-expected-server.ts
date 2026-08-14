import { type E2eEnv, isMockProfile } from '../profile/profile';

/** Opts out of the guard, for a developer who knows what they are attaching to. */
export const ALLOW_DEV_SERVER_VAR = 'R10C_E2E_ALLOW_DEV_SERVER';

/**
 * Liveness, not the config's `readyPath`: every app answers it, it answers from
 * the process alone, and it carries the one field this check needs. `readyPath`
 * differs per app and defaults to `/`, which returns HTML.
 */
const LIVENESS_PATH = '/api/health/live';

/**
 * The second signal, which needs no cooperation from the app at all.
 *
 * `next dev` serves its static assets under the literal segment `development`;
 * a production build uses a hashed build id, so this 404s under `next start`.
 * It is a Next internal and therefore the *fallback*, but it is the one that
 * survives the case that motivates it: an `nx e2e` run builds into the same
 * `.next` the running dev server owns, which corrupts that server's Turbopack
 * cache and makes every app route — liveness included — answer `500`. A guard
 * that only asked the app would degrade to "cannot tell" at exactly the moment
 * it is needed.
 */
const DEV_ASSET_PATH = '/_next/static/development/_buildManifest.js';

/** A probe that hangs must not hold the whole run hostage. */
const PROBE_TIMEOUT_MS = 5_000;

export interface AssertExpectedServerOptions {
  /** Where the suite is pointed, e.g. `http://localhost:3001`. */
  readonly baseURL: string;
  readonly env?: E2eEnv;
  readonly fetchImpl?: typeof fetch;
  readonly warn?: (message: string) => void;
}

const describeMismatch = (baseURL: string): string =>
  [
    `The hermetic e2e profile attached to a DEVELOPMENT server at ${baseURL}.`,
    '',
    'Playwright reuses whatever already listens on the app port, so this run would',
    'test `next dev` — a different bundle, no prerender, and with the dev fleet',
    "behind it the real services instead of this profile's fakes. It can fail, or",
    'pass, for reasons that have nothing to do with the code under test. The build',
    'this run just made also writes the same `.next` the dev server owns, which',
    'corrupts its Turbopack cache on the way past.',
    '',
    'Stop the dev server on that port and run again, or set',
    `${ALLOW_DEV_SERVER_VAR}=1 to accept the risk.`,
  ].join('\n');

/**
 * Refuses to run the hermetic suite against a development server.
 *
 * `reuseExistingServer` is what makes a local run fast, and turning it off costs
 * a production build every time. So the reuse stays and the *assumption* is
 * checked instead: the `mock` profile's whole claim is that it is hermetic, and
 * attached to a dev server it is not. Turning a silent wrong answer into a loud
 * failure is the trade — see issue #69.
 *
 * `live` is exempt on purpose: it expects an already-running app and makes no
 * hermeticity claim, so which build answers is the operator's business.
 *
 * Only when **both** signals are unreadable does the run continue, with a
 * warning: an app that exposes neither is not a reason to refuse to test it.
 */
export const assertExpectedServer = async ({
  baseURL,
  env = process.env,
  fetchImpl = fetch,
  warn = message => console.warn(message),
}: AssertExpectedServerOptions): Promise<void> => {
  if (!isMockProfile(env)) return;

  const override = env[ALLOW_DEV_SERVER_VAR];
  if (override !== undefined && override !== '') return;

  const get = async (path: string): Promise<Response | undefined> => {
    try {
      return await fetchImpl(`${baseURL}${path}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
    } catch {
      return undefined;
    }
  };

  const liveness = await get(LIVENESS_PATH);
  if (liveness?.ok === true) {
    const mode = ((await liveness.json()) as { mode?: unknown }).mode;
    if (mode === 'production') return;
    if (mode === 'development') throw new Error(describeMismatch(baseURL));
  }

  // The app could not answer for itself. Ask Next directly.
  const devAsset = await get(DEV_ASSET_PATH);
  if (devAsset === undefined) {
    warn(
      `e2e: could not reach ${baseURL}; cannot tell which build is serving.`,
    );
    return;
  }

  if (devAsset.ok) throw new Error(describeMismatch(baseURL));
};

/** One probe per worker process, whatever the outcome. */
let verdict: Promise<void> | undefined;

/**
 * The form `defineEntifixE2eTest` calls, from an auto fixture.
 *
 * A fixture rather than `globalSetup`, which is where this naturally belongs:
 * Playwright loads a `globalSetup` file through a different module path than
 * the config and the specs, and this package is `"type": "module"` while an
 * app's `playwright.config.ts` is CJS — the same file transpiles for one and
 * throws `exports is not defined in ES module scope` for the other. The
 * fixture rides the path that already works, at the cost of reporting the
 * refusal once per test rather than once per run.
 *
 * The promise is cached, so the probe happens once and every subsequent test
 * rejects with the same error instead of re-asking a server that will not have
 * changed mid-run.
 */
export const assertExpectedServerOnce = (
  baseURL: string | undefined,
): Promise<void> => {
  if (baseURL === undefined || baseURL === '') return Promise.resolve();

  verdict ??= assertExpectedServer({ baseURL });
  return verdict;
};
