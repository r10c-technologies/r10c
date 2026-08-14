import {
  ConfigurationClientInMemory,
  ConfigurationPlain,
  EntifixConnError,
} from '@r10c/entifix-ts-core';
import { Context, Effect, Schedule } from 'effect';

import { SERVICE_TOKEN_HEADER, serviceToken } from './auth/service-token';

/**
 * DI tag carrying the raw {@link ConfigurationPlain} a service loaded at boot,
 * so a `GET /api/config` introspection route can expose it (redacted).
 */
export class LoadedConfigurationTag extends Context.Tag(
  'LoadedConfigurationTag',
)<LoadedConfigurationTag, ConfigurationPlain>() {}

/**
 * Default boot-fetch retry policy: 20 attempts spaced 1s apart (~20s window).
 *
 * A dependent service `dev` target `dependsOn config-service:dev`, but Nx
 * considers a *continuous* dependency "ready" the moment its process starts —
 * not when its HTTP server is listening and its table is seeded. So a fast
 * backend can fire its boot fetch before config-service answers and, without a
 * retry, would crash with `fetch failed` (connection refused). Retrying a
 * bounded window lets the fleet come up in any order.
 */
export const defaultConfigRetrySchedule: Schedule.Schedule<unknown, unknown> =
  Schedule.intersect(Schedule.spaced('1 seconds'), Schedule.recurs(20));

/**
 * Deadline for a single boot-fetch attempt.
 *
 * **The retry above only helps if an attempt can fail.** `fetch` has no timeout
 * of its own, so a connection that is accepted but never answered — a previous
 * listener dying mid-flight, a half-open socket — leaves it waiting forever.
 * The schedule never sees a failure, never retries, and the service hangs in its
 * boot layer with its port bound and nothing served: measured twice on
 * 2026-08-14, on auth-service and then marketplace-service, recovered only by a
 * full `dev:reset` ([#84](https://github.com/r10c-technologies/r10c/issues/84)).
 *
 * So an attempt is deadlined, for the same reason a readiness probe is: a check
 * that hangs is a check that failed. The ordinary race this retry was written
 * for — config-service not listening yet — still fails instantly with
 * `ECONNREFUSED` and costs nothing, so this bounds the pathological case only:
 * 20 retries × (5s deadline + 1s spacing) ≈ 2 minutes before the service exits
 * loudly instead of hanging silently.
 */
export const defaultConfigAttemptTimeoutMs = 5_000;

/** Options for {@link loadRemoteConfiguration}. */
export interface LoadRemoteConfigurationOptions {
  /**
   * Retry policy for the boot fetch. Defaults to
   * {@link defaultConfigRetrySchedule}. Pass `Schedule.stop` to fail fast (a
   * single attempt, no retry) — used by tests and callers that want the error
   * immediately.
   */
  readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;
  /**
   * Deadline for one attempt, in milliseconds. Defaults to
   * {@link defaultConfigAttemptTimeoutMs}. There is deliberately no way to
   * disable it — an attempt that cannot time out is the bug this exists for.
   */
  readonly attemptTimeoutMs?: number;
}

/**
 * Fetches a service's configuration from the central config-service
 * (`GET {configApiUrl}/api/config/{service}`) and returns it as a
 * {@link ConfigurationPlain}. Backends call this at boot to resolve their own
 * parameters (e.g. `mongo.uri`) instead of hardcoding them.
 *
 * Uses Node's global `fetch` (same transport approach as the REST client); any
 * network/parse/non-2xx failure becomes an {@link EntifixConnError}. Each
 * attempt is deadlined ({@link defaultConfigAttemptTimeoutMs}) and the fetch is
 * retried on a bounded schedule ({@link defaultConfigRetrySchedule}), so a
 * dependent that boots before config-service is HTTP-ready waits it out — and
 * one that reaches a socket nobody is answering gives up rather than hanging.
 */
export const loadRemoteConfiguration = (
  configApiUrl: string,
  service: string,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationPlain, EntifixConnError> => {
  const url = `${configApiUrl.replace(/\/+$/, '')}/api/config/${service}`;
  const attemptTimeoutMs =
    options.attemptTimeoutMs ?? defaultConfigAttemptTimeoutMs;

  const fetchOnce = Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { [SERVICE_TOKEN_HEADER]: serviceToken() },
        signal: AbortSignal.timeout(attemptTimeoutMs),
      }).catch((error: unknown) => {
        // Rewritten because the raw abort says `This operation was aborted`,
        // which reads like a bug in the caller rather than a silent peer.
        if (error instanceof Error && error.name === 'TimeoutError') {
          throw new Error(
            `config-service did not answer within ${attemptTimeoutMs}ms at ${url}`,
          );
        }
        throw error;
      });
      if (!response.ok) {
        throw new Error(
          `config-service responded ${response.status} for ${url}`,
        );
      }
      return (await response.json()) as ConfigurationPlain;
    },
    catch: error =>
      new EntifixConnError(
        `Failed to load configuration for "${service}" from config-service`,
        error,
        { url, service },
      ),
  });

  return Effect.retry(
    fetchOnce,
    options.retrySchedule ?? defaultConfigRetrySchedule,
  );
};

/**
 * Convenience: load the remote configuration and wrap it in a
 * {@link ConfigurationClientInMemory} ready to satisfy `ConfigurationRepositoryTag`
 * and to read the service's own parameters via `.in(group).getString(key)`.
 */
export const loadRemoteConfigurationClient = (
  configApiUrl: string,
  service: string,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationClientInMemory, EntifixConnError> =>
  loadRemoteConfiguration(configApiUrl, service, options).pipe(
    Effect.map(plain => new ConfigurationClientInMemory(plain)),
  );
