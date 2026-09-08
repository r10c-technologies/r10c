import {
  ConfigurationClient,
  ConfigurationClientGroup,
  ConfigurationClientInMemory,
  ConfigurationExtractMode,
  ConfigurationPlain,
  EntifixBuildError,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

export interface ConfigurationClientRestClientOptions {
  /** Endpoint returning this service's `ConfigurationPlain`. */
  url?: string;
  /**
   * Headers to send with the lookup.
   *
   * Empty for the browser, which reads its own app's same-origin `/api/config`
   * and needs nothing. A **server** component reads config-service directly —
   * there is no origin to proxy through and no browser to hide an address from
   * — and that endpoint is gated on the shared fleet token, so the caller has
   * to carry it. The header itself stays out of this package: the token is a
   * Next server concern and lives in `shells-next-common`.
   */
  headers?: Readonly<Record<string, string>>;
}

const DEFAULT_CONFIG_URL = '/api/config';

/**
 * {@link ConfigurationClientGroup} view over an HTTP-sourced
 * {@link ConfigurationPlain}. Resolution is delegated to an in-memory store
 * once the plain configuration has been fetched.
 */
class ConfigurationClientGroupRestClient implements ConfigurationClientGroup {
  constructor(
    private readonly loadPlain: Effect.Effect<
      ConfigurationPlain,
      EntifixBuildError
    >,
    private readonly group: string,
  ) {}

  #pending() {
    return Effect.die(
      new Error(
        'ConfigurationClientGroupRestClient getter not implemented yet',
      ),
    );
  }

  getString(key: string, extractMode?: ConfigurationExtractMode) {
    return this.loadPlain.pipe(
      Effect.flatMap(plain =>
        new ConfigurationClientInMemory(plain)
          .in(this.group)
          .getString(key, extractMode),
      ),
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
 * {@link ConfigurationClient} that sources its `ConfigurationPlain` over HTTP
 * (by default the same-origin `/api/config` route, which proxies
 * marketplace-config-api). The fetched configuration is memoized so it is
 * requested at most once per client instance.
 */
export class ConfigurationClientRestClient implements ConfigurationClient {
  #loadPlain: Effect.Effect<ConfigurationPlain, EntifixBuildError>;

  constructor(options?: ConfigurationClientRestClientOptions) {
    const url = options?.url ?? DEFAULT_CONFIG_URL;
    const headers = options?.headers;
    let cache: Promise<ConfigurationPlain> | undefined;

    this.#loadPlain = Effect.tryPromise({
      try: () =>
        (cache ??= fetch(url, { headers }).then(response => {
          if (!response.ok) {
            throw new Error(
              `Configuration request to ${url} failed with status ${response.status}`,
            );
          }
          return response.json() as Promise<ConfigurationPlain>;
        })),
      catch: error =>
        new EntifixBuildError('Failed to load configuration', error, { url }),
    });
  }

  in(group: string): ConfigurationClientGroup {
    return new ConfigurationClientGroupRestClient(this.#loadPlain, group);
  }
}
