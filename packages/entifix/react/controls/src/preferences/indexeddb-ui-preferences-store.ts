import { EntifixConnError, type EntifixError } from '@r10c/entifix-ts-core';
import { Effect, Layer } from 'effect';
import { type IDBPDatabase, openDB } from 'idb';

import { DEFAULT_UI_PREFERENCES_NAMESPACE } from './local-storage-ui-preferences-store';
import {
  type UiPreferencesStore,
  UiPreferencesStoreTag,
} from './ui-preferences-store';

const DB_NAME = 'entifix-ui-preferences';
const STORE_NAME = 'preferences';

/** No IndexedDB during SSR — reads resolve empty and writes are dropped. */
function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * `IndexedDB`-backed {@link UiPreferencesStore} — the persistence seam for all
 * client UI state (column layout, sidebar collapse, and now the tab workspace),
 * unifying it with the tab/draft stores in one datastore instead of splitting
 * between `localStorage` and IndexedDB.
 *
 * The port is unchanged: every method closes over the namespace, so each is
 * `R = never`. Values are stored via structured clone (no JSON round-trip), and
 * a failed I/O surfaces as an {@link EntifixConnError} the caller can fall back
 * from — a stale view should degrade to defaults, not break.
 */
export function makeIndexedDbUiPreferencesStore(
  namespace: string = DEFAULT_UI_PREFERENCES_NAMESPACE,
): UiPreferencesStore {
  const storageKey = (key: string) => `${namespace}:${key}`;

  let database: Promise<IDBPDatabase> | undefined;
  const open = () =>
    (database ??= openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE_NAME);
      },
    }));

  const io = <TValue>(
    action: string,
    key: string,
    run: () => Promise<TValue>,
  ): Effect.Effect<TValue, EntifixError> =>
    Effect.tryPromise({
      try: run,
      catch: cause =>
        new EntifixConnError(
          `Unable to ${action} UI preference "${key}"`,
          cause,
        ) as EntifixError,
    });

  return {
    read: <TValue>(key: string) =>
      io<TValue | undefined>('read', key, async () => {
        if (!hasIndexedDb()) return undefined;
        return (await open()).get(STORE_NAME, storageKey(key)) as Promise<
          TValue | undefined
        >;
      }),

    write: <TValue>(key: string, value: TValue) =>
      io<void>('write', key, async () => {
        if (!hasIndexedDb()) return;
        await (await open()).put(STORE_NAME, value, storageKey(key));
      }),

    remove: (key: string) =>
      io<void>('remove', key, async () => {
        if (!hasIndexedDb()) return;
        await (await open()).delete(STORE_NAME, storageKey(key));
      }),
  };
}

export const IndexedDbUiPreferencesLayer = Layer.succeed(
  UiPreferencesStoreTag,
  makeIndexedDbUiPreferencesStore(),
);
