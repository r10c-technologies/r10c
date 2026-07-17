import { Effect } from 'effect';

import { EntifixBuildError } from '../entifix-error';
import {
  ConfigurationExtractMode,
  ConfigurationItem,
  ConfigurationPlain,
  ConfigurationStore,
  ConfigurationStoreGroup,
} from './types';

/**
 * Joins a base URL with extra path segments, normalizing slashes so neither
 * doubled nor missing separators appear (e.g. `http://h/api` + `['product']`
 * -> `http://h/api/product`).
 */
function composeUrl(base: string, segments: string[]): string {
  return [
    base.replace(/\/+$/, ''),
    ...segments.map(segment => segment.replace(/^\/+|\/+$/g, '')),
  ]
    .filter(part => part.length > 0)
    .join('/');
}

/** Parses a raw string into a finite number, failing on non-numeric input. */
function parseNumber(
  key: string,
  raw: string
): Effect.Effect<number, EntifixBuildError> {
  const parsed = Number(raw);
  if (raw.trim() === '' || Number.isNaN(parsed)) {
    return Effect.fail(
      new EntifixBuildError(`Configuration key "${key}" is not a number`, undefined, {
        key,
        raw,
      })
    );
  }
  return Effect.succeed(parsed);
}

/** Parses a raw string into a valid Date, failing on unparseable input. */
function parseDate(
  key: string,
  raw: string
): Effect.Effect<Date, EntifixBuildError> {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return Effect.fail(
      new EntifixBuildError(`Configuration key "${key}" is not a date`, undefined, {
        key,
        raw,
      })
    );
  }
  return Effect.succeed(parsed);
}

/** Splits a comma-separated raw value into trimmed, non-empty segments. */
function splitArray(raw: string): string[] {
  return raw
    .split(',')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0);
}

/**
 * In-memory {@link ConfigurationStoreGroup} backed by a group's
 * {@link ConfigurationItem} list.
 *
 * String resolution supports `exact` and `compose`; the numeric/date/array
 * getters resolve the raw value with `exact` semantics (the `compose` mode is
 * URL-oriented and only meaningful for strings). `match` remains unimplemented
 * (no defined semantics / consumer yet) and fails explicitly.
 */
export class ConfigurationStoreGroupInMemory
  implements ConfigurationStoreGroup
{
  #items: ConfigurationItem[];

  constructor(items: ConfigurationItem[] = []) {
    this.#items = items;
  }

  #find(key: string): ConfigurationItem | undefined {
    return this.#items.find(candidate => candidate.key === key);
  }

  #lookup(key: string): Effect.Effect<string, EntifixBuildError> {
    const item = this.#find(key);
    if (item === undefined || item.value == null) {
      return Effect.fail(
        new EntifixBuildError(
          `Configuration key "${key}" not found`,
          undefined,
          { key, availableKeys: this.#items.map(candidate => candidate.key) }
        )
      );
    }
    return Effect.succeed(String(item.value));
  }

  #lookupOptional(key: string): Effect.Effect<string | undefined, never> {
    const item = this.#find(key);
    return Effect.succeed(
      item === undefined || item.value == null ? undefined : String(item.value)
    );
  }

  #unsupportedMode(
    key: string,
    extractMode: ConfigurationExtractMode
  ): Effect.Effect<never, EntifixBuildError> {
    return Effect.fail(
      new EntifixBuildError(
        `Configuration extract mode "${extractMode}" is not implemented yet`,
        undefined,
        { key, extractMode }
      )
    );
  }

  getString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<string, EntifixBuildError> {
    if (extractMode === 'compose') {
      const [head, ...segments] = key.split('.');
      return this.#lookup(head).pipe(
        Effect.map(base => composeUrl(base, segments))
      );
    }
    if (extractMode === 'exact') {
      return this.#lookup(key);
    }
    return this.#unsupportedMode(key, extractMode);
  }

  getNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<number, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.flatMap(raw => parseNumber(key, raw)));
  }

  getDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<Date, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.flatMap(raw => parseDate(key, raw)));
  }

  getArrayString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<string[], EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(Effect.map(splitArray));
  }

  getArrayNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<number[], EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(
      Effect.flatMap(raw =>
        Effect.all(splitArray(raw).map(segment => parseNumber(key, segment)))
      )
    );
  }

  getArrayDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<Date[], EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookup(key).pipe(
      Effect.flatMap(raw =>
        Effect.all(splitArray(raw).map(segment => parseDate(key, segment)))
      )
    );
  }

  getOptionalString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<string | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key);
  }

  getOptionalNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<number | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined ? Effect.succeed(undefined) : parseNumber(key, raw)
      )
    );
  }

  getOptionalDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<Date | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined ? Effect.succeed(undefined) : parseDate(key, raw)
      )
    );
  }

  getOptionalArrayNumber(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<number[] | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined
          ? Effect.succeed(undefined)
          : Effect.all(splitArray(raw).map(segment => parseNumber(key, segment)))
      )
    );
  }

  getOptionalArrayString(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<string[] | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.map(raw => (raw === undefined ? undefined : splitArray(raw)))
    );
  }

  getOptionalArrayDate(
    key: string,
    extractMode: ConfigurationExtractMode = 'exact'
  ): Effect.Effect<Date[] | undefined, EntifixBuildError> {
    if (extractMode !== 'exact') return this.#unsupportedMode(key, extractMode);
    return this.#lookupOptional(key).pipe(
      Effect.flatMap(raw =>
        raw === undefined
          ? Effect.succeed(undefined)
          : Effect.all(splitArray(raw).map(segment => parseDate(key, segment)))
      )
    );
  }
}

/**
 * In-memory {@link ConfigurationStore} backed by a loaded
 * {@link ConfigurationPlain}. Each `in(group)` returns a group view scoped to
 * that group's items.
 */
export class ConfigurationStoreInMemory implements ConfigurationStore {
  #plainConfig: ConfigurationPlain;

  constructor(plainConfig: ConfigurationPlain = {}) {
    this.#plainConfig = plainConfig;
  }

  in(group: string): ConfigurationStoreGroup {
    return new ConfigurationStoreGroupInMemory(this.#plainConfig[group] ?? []);
  }
}
