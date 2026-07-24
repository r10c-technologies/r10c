import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { makeIndexedDbStateStorage } from './idb-state-storage.js';

describe('makeIndexedDbStateStorage', () => {
  it('round-trips a value', async () => {
    const storage = makeIndexedDbStateStorage('db-a', 'store');

    await storage.setItem('k', '{"a":1}');

    expect(await storage.getItem('k')).toBe('{"a":1}');
  });

  it('returns null for a missing key', async () => {
    const storage = makeIndexedDbStateStorage('db-b', 'store');

    expect(await storage.getItem('missing')).toBeNull();
  });

  it('removes a value', async () => {
    const storage = makeIndexedDbStateStorage('db-c', 'store');
    await storage.setItem('k', 'v');

    await storage.removeItem('k');

    expect(await storage.getItem('k')).toBeNull();
  });

  describe('without IndexedDB (SSR)', () => {
    it('resolves reads null and drops writes/removes', async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error — simulate the server.
      delete globalThis.indexedDB;
      try {
        const storage = makeIndexedDbStateStorage('ssr-db', 'store');
        await storage.setItem('k', 'v');
        await storage.removeItem('k');
        expect(await storage.getItem('k')).toBeNull();
      } finally {
        globalThis.indexedDB = original;
      }
    });
  });
});
