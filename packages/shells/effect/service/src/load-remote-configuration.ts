import {
  ConfigurationPlain,
  ConfigurationStoreInMemory,
  EntifixConnError,
} from '@r10c/entifix-ts-core';
import { Context, Effect, Schedule } from 'effect';

/**
 * DI tag carrying the raw {@link ConfigurationPlain} a service loaded at boot,
 * so a `GET /api/config` introspection route can expose it (redacted).
 */
export class LoadedConfigurationTag extends Context.Tag('LoadedConfigurationTag')<
  LoadedConfigurationTag,
  ConfigurationPlain
>() {}

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

/** Options for {@link loadRemoteConfiguration}. */
export interface LoadRemoteConfigurationOptions {
  /**
   * Retry policy for the boot fetch. Defaults to
   * {@link defaultConfigRetrySchedule}. Pass `Schedule.stop` to fail fast (a
   * single attempt, no retry) — used by tests and callers that want the error
   * immediately.
   */
  readonly retrySchedule?: Schedule.Schedule<unknown, unknown>;
}

/**
 * Fetches a service's configuration from the central config-service
 * (`GET {configApiUrl}/api/config/{service}`) and returns it as a
 * {@link ConfigurationPlain}. Backends call this at boot to resolve their own
 * parameters (e.g. `mongo.uri`) instead of hardcoding them.
 *
 * Uses Node's global `fetch` (same transport approach as the REST client); any
 * network/parse/non-2xx failure becomes an {@link EntifixConnError}. The fetch
 * is retried on a bounded schedule ({@link defaultConfigRetrySchedule}) so a
 * dependent that boots before config-service is HTTP-ready waits it out.
 */
export const loadRemoteConfiguration = (
  configApiUrl: string,
  service: string,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationPlain, EntifixConnError> => {
  const url = `${configApiUrl.replace(/\/+$/, '')}/api/config/${service}`;
  const fetchOnce = Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`config-service responded ${response.status} for ${url}`);
      }
      return (await response.json()) as ConfigurationPlain;
    },
    catch: error =>
      new EntifixConnError(
        `Failed to load configuration for "${service}" from config-service`,
        error,
        { url, service }
      ),
  });

  return Effect.retry(fetchOnce, options.retrySchedule ?? defaultConfigRetrySchedule);
};

/**
 * Convenience: load the remote configuration and wrap it in a
 * {@link ConfigurationStoreInMemory} ready to satisfy `ConfigurationRepositoryTag`
 * and to read the service's own parameters via `.in(group).getString(key)`.
 */
export const loadRemoteConfigurationStore = (
  configApiUrl: string,
  service: string,
  options: LoadRemoteConfigurationOptions = {},
): Effect.Effect<ConfigurationStoreInMemory, EntifixConnError> =>
  loadRemoteConfiguration(configApiUrl, service, options).pipe(
    Effect.map(plain => new ConfigurationStoreInMemory(plain))
  );
