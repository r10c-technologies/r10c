import axios, { type AxiosInstance } from 'axios';
import { afterAll, beforeAll } from 'vitest';

import {
  type E2eProfile,
  requireLiveUrl,
  resolveE2eProfile,
} from '../profile/profile';

/** A service booted for the run, whichever profile started it. */
export interface RunningService {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export interface ServiceE2eOptions {
  /**
   * The variable a `live` run reads its target from, e.g.
   * `MARKETPLACE_ADMIN_SERVICE_URL`.
   */
  liveUrlEnvVar: string;
  /**
   * Boots the service in-process for a `mock` run. Supplied by the e2e project
   * rather than by this package, because only the project knows its own
   * `router` and which fakes stand in for its infrastructure — and because a
   * package under `entifix` must not depend on a `shells` one.
   */
  startMock: () => Promise<RunningService>;
}

/**
 * The handle a service e2e spec works through. `client` and `baseUrl` are only
 * valid once the suite has started, so both are getters that fail loudly rather
 * than handing out an empty string.
 */
export interface ServiceE2eContext {
  readonly profile: E2eProfile;
  readonly baseUrl: string;
  readonly client: AxiosInstance;
}

/**
 * Wires a service e2e suite to the active profile.
 *
 * In `mock` the service is booted in-process against driver fakes; in `live` it
 * is the process already running on `liveUrlEnvVar`. Either way the spec gets
 * the same axios client against the same routes, so ONE suite covers both — no
 * `test.skip` on an env var, and no second copy of the journeys.
 *
 * Call it at the top level of a spec file; it registers the suite hooks itself.
 */
export const defineServiceE2e = ({
  liveUrlEnvVar,
  startMock,
}: ServiceE2eOptions): ServiceE2eContext => {
  const profile = resolveE2eProfile();
  let running: RunningService | undefined;
  let client: AxiosInstance | undefined;

  const started = (): RunningService => {
    if (running === undefined) {
      throw new Error(
        'The e2e service is not running yet — read `baseUrl`/`client` inside a test, not at module scope.',
      );
    }
    return running;
  };

  beforeAll(async () => {
    running =
      profile === 'mock'
        ? await startMock()
        : {
            baseUrl: requireLiveUrl(liveUrlEnvVar),
            // Nothing to tear down: the live process outlives the run.
            close: () => Promise.resolve(),
          };
    client = axios.create({
      baseURL: running.baseUrl,
      // 4xx and 5xx are assertion subjects in these suites, not transport
      // failures — a service e2e that cannot assert on a 400 is missing half
      // its surface.
      validateStatus: () => true,
    });
  });

  afterAll(async () => {
    await running?.close();
    running = undefined;
    client = undefined;
  });

  return {
    profile,
    get baseUrl() {
      return started().baseUrl;
    },
    get client() {
      started();
      return client as AxiosInstance;
    },
  };
};
