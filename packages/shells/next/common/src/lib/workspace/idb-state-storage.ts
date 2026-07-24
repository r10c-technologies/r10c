import { type IDBPDatabase, openDB } from 'idb';
import type { StateStorage } from 'zustand/middleware';

/**
 * A Zustand {@link StateStorage} backed by IndexedDB — the persistence seam for
 * the workspace stores, so open tabs and drafts survive a refresh. SSR-safe:
 * with no `indexedDB` (the server) reads resolve `null` and writes are dropped,
 * so the store simply starts empty until the client hydrates.
 */
export function makeIndexedDbStateStorage(
  dbName: string,
  storeName: string,
): StateStorage {
  let database: Promise<IDBPDatabase> | undefined;
  const hasIndexedDb = () => typeof indexedDB !== 'undefined';
  const open = () =>
    (database ??= openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore(storeName);
      },
    }));

  return {
    getItem: async name => {
      if (!hasIndexedDb()) return null;
      return (
        ((await (await open()).get(storeName, name)) as string | undefined) ??
        null
      );
    },
    setItem: async (name, value) => {
      if (!hasIndexedDb()) return;
      await (await open()).put(storeName, value, name);
    },
    removeItem: async name => {
      if (!hasIndexedDb()) return;
      await (await open()).delete(storeName, name);
    },
  };
}
