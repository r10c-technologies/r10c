import { Effect } from 'effect';
import {
  ConfigurationExtractMode,
  ConfigurationPlain,
  ConfigurationStore,
  ConfigurationStoreGroup,
  ConfigurationStoreInMemory,
  EntifixBuildError,
} from '@r10c/entifix-ts-core';

export interface ConfigurationStoreRestClientOptions {
  /** Endpoint returning this service's `ConfigurationPlain`. */
  url?: string;
}

const DEFAULT_CONFIG_URL = '/api/config';

/**
 * {@link ConfigurationStoreGroup} view over an HTTP-sourced
 * {@link ConfigurationPlain}. Resolution is delegated to an in-memory store
 * once the plain configuration has been fetched.
 */
class ConfigurationStoreGroupRestClient implements ConfigurationStoreGroup {
  constructor(
    private readonly loadPlain: Effect.Effect<
      ConfigurationPlain,
      EntifixBuildError
    >,
    private readonly group: string
  ) {}

  #pending() {
    return Effect.die(
      new Error('ConfigurationStoreGroupRestClient getter not implemented yet')
    );
  }

  getString(key: string, extractMode?: ConfigurationExtractMode) {
    return this.loadPlain.pipe(
      Effect.flatMap(plain =>
        new ConfigurationStoreInMemory(plain)
          .in(this.group)
          .getString(key, extractMode)
      )
    );
  }

  getNumber() {
    return this.#pending();
  }
  getDate() {
    return this.#pending();
  }
  getArrayNumber() {
    return this.#pending();
  }
  getArrayString() {
    return this.#pending();
  }
  getArrayDate() {
    return this.#pending();
  }
  getOptionalNumber() {
    return this.#pending();
  }
  getOptionalString() {
    return this.#pending();
  }
  getOptionalDate() {
    return this.#pending();
  }
  getOptionalArrayNumber() {
    return this.#pending();
  }
  getOptionalArrayString() {
    return this.#pending();
  }
  getOptionalArrayDate() {
    return this.#pending();
  }
}

/**
 * {@link ConfigurationStore} that sources its `ConfigurationPlain` over HTTP
 * (by default the same-origin `/api/config` route, which proxies
 * marketplace-config-api). The fetched configuration is memoized so it is
 * requested at most once per client instance.
 */
export class ConfigurationStoreRestClient implements ConfigurationStore {
  #loadPlain: Effect.Effect<ConfigurationPlain, EntifixBuildError>;

  constructor(options?: ConfigurationStoreRestClientOptions) {
    const url = options?.url ?? DEFAULT_CONFIG_URL;
    let cache: Promise<ConfigurationPlain> | undefined;

    this.#loadPlain = Effect.tryPromise({
      try: () =>
        (cache ??= fetch(url).then(response => {
          if (!response.ok) {
            throw new Error(
              `Configuration request to ${url} failed with status ${response.status}`
            );
          }
          return response.json() as Promise<ConfigurationPlain>;
        })),
      catch: error =>
        new EntifixBuildError('Failed to load configuration', error, { url }),
    });
  }

  in(group: string): ConfigurationStoreGroup {
    return new ConfigurationStoreGroupRestClient(this.#loadPlain, group);
  }
}
