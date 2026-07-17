import {
  ConfigurationPlain,
  ConfigurationStoreInMemory,
  EntifixConnError,
} from '@r10c/entifix-ts-core';
import { Context, Effect } from 'effect';

/**
 * DI tag carrying the raw {@link ConfigurationPlain} a service loaded at boot,
 * so a `GET /api/config` introspection route can expose it (redacted).
 */
export class LoadedConfigurationTag extends Context.Tag('LoadedConfigurationTag')<
  LoadedConfigurationTag,
  ConfigurationPlain
>() {}

/**
 * Fetches a service's configuration from the central config-service
 * (`GET {configApiUrl}/api/config/{service}`) and returns it as a
 * {@link ConfigurationPlain}. Backends call this at boot to resolve their own
 * parameters (e.g. `mongo.uri`) instead of hardcoding them.
 *
 * Uses Node's global `fetch` (same transport approach as the REST client); any
 * network/parse/non-2xx failure becomes an {@link EntifixConnError}.
 */
export const loadRemoteConfiguration = (
  configApiUrl: string,
  service: string
): Effect.Effect<ConfigurationPlain, EntifixConnError> => {
  const url = `${configApiUrl.replace(/\/+$/, '')}/api/config/${service}`;
  return Effect.tryPromise({
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
};

/**
 * Convenience: load the remote configuration and wrap it in a
 * {@link ConfigurationStoreInMemory} ready to satisfy `ConfigurationRepositoryTag`
 * and to read the service's own parameters via `.in(group).getString(key)`.
 */
export const loadRemoteConfigurationStore = (
  configApiUrl: string,
  service: string
): Effect.Effect<ConfigurationStoreInMemory, EntifixConnError> =>
  loadRemoteConfiguration(configApiUrl, service).pipe(
    Effect.map(plain => new ConfigurationStoreInMemory(plain))
  );
