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

/**
 * In-memory {@link ConfigurationStoreGroup} backed by a group's
 * {@link ConfigurationItem} list.
 *
 * Only string resolution (`exact` and `compose`) is implemented for now; the
 * numeric/date/array getters and the `match` mode remain a not-implemented
 * defect and will be filled in alongside future iterations.
 */
export class ConfigurationStoreGroupInMemory
  implements ConfigurationStoreGroup
{
  #items: ConfigurationItem[];

  constructor(items: ConfigurationItem[] = []) {
    this.#items = items;
  }

  #lookup(key: string): Effect.Effect<string, EntifixBuildError> {
    const item = this.#items.find(candidate => candidate.key === key);
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

  #pending() {
    return Effect.die(
      new Error('ConfigurationStoreGroupInMemory getter not implemented yet')
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

    return Effect.fail(
      new EntifixBuildError(
        `Configuration extract mode "${extractMode}" is not implemented yet`,
        undefined,
        { key, extractMode }
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
