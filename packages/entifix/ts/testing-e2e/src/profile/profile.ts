/**
 * The two ways an e2e suite can be run.
 *
 * - `mock` — hermetic. The system under test is real; everything it talks to is
 *   a fake wired in at the transport boundary. Needs no infrastructure, so it
 *   runs on every pull request.
 * - `live` — the same journeys against real services and real datastores.
 *   Run locally (or against a deployment) once the infra stack is up.
 *
 * The profile is a *run* concern, never a spec concern: a spec asks the fixture
 * for a client or a page and stays identical in both.
 */
export const E2E_PROFILES = ['mock', 'live'] as const;

export type E2eProfile = (typeof E2E_PROFILES)[number];

/** The environment variable that selects the profile. */
export const E2E_PROFILE_VAR = 'E2E_PROFILE';

/**
 * `mock` is the default because the default has to be the one that runs
 * anywhere: a fresh clone, a CI runner, a laptop with no minikube. Requiring
 * infrastructure to get a green run is how e2e suites end up being skipped.
 */
export const DEFAULT_E2E_PROFILE: E2eProfile = 'mock';

/** Just enough of `process.env` to read from, so specs can pass a literal. */
export type E2eEnv = Record<string, string | undefined>;

const isProfile = (value: string): value is E2eProfile =>
  (E2E_PROFILES as readonly string[]).includes(value);

/**
 * Reads the profile from the environment.
 *
 * An unrecognized value throws rather than falling back: `E2E_PROFILE=live-ish`
 * silently running the mock suite is exactly the failure this whole seam exists
 * to prevent.
 */
export const resolveE2eProfile = (env: E2eEnv = process.env): E2eProfile => {
  const raw = env[E2E_PROFILE_VAR];
  if (raw === undefined || raw === '') return DEFAULT_E2E_PROFILE;
  if (isProfile(raw)) return raw;

  throw new Error(
    `Unknown ${E2E_PROFILE_VAR} "${raw}". Expected one of: ${E2E_PROFILES.join(', ')}.`,
  );
};

export const isMockProfile = (env?: E2eEnv): boolean =>
  resolveE2eProfile(env) === 'mock';

export const isLiveProfile = (env?: E2eEnv): boolean =>
  resolveE2eProfile(env) === 'live';

/**
 * The base URL a `live` run must be pointed at, or a failure explaining how.
 *
 * It **throws**; it does not skip. A suite that skips itself when its target is
 * missing reports green for a run that tested nothing, which is how a broken
 * live environment stays unnoticed.
 */
export const requireLiveUrl = (
  variable: string,
  env: E2eEnv = process.env,
): string => {
  const value = env[variable];
  if (value === undefined || value === '') {
    throw new Error(
      `${E2E_PROFILE_VAR}=live requires ${variable} to point at the running service, e.g. ${variable}=http://localhost:3101.`,
    );
  }
  return value.replace(/\/+$/, '');
};
