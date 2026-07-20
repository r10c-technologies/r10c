/**
 * @jest-environment jsdom
 */
import { Effect } from 'effect';

import { makeLocalStorageUiPreferencesStore } from './local-storage-ui-preferences-store';

describe('makeLocalStorageUiPreferencesStore', () => {
  const store = makeLocalStorageUiPreferencesStore('test-ns');

  beforeEach(() => window.localStorage.clear());

  it('round-trips a value under the namespaced key', async () => {
    await Effect.runPromise(
      store.write('entity-table:gadget', { order: ['name'] }),
    );

    expect(window.localStorage.getItem('test-ns:entity-table:gadget')).toBe(
      '{"order":["name"]}',
    );
    await expect(
      Effect.runPromise(store.read('entity-table:gadget')),
    ).resolves.toEqual({ order: ['name'] });
  });

  it('resolves undefined for a key that was never written', async () => {
    await expect(
      Effect.runPromise(store.read('missing')),
    ).resolves.toBeUndefined();
  });

  it('falls back to undefined rather than failing on unparseable JSON', async () => {
    window.localStorage.setItem('test-ns:broken', '{not json');
    await expect(
      Effect.runPromise(store.read('broken')),
    ).resolves.toBeUndefined();
  });

  it('removes a stored value', async () => {
    await Effect.runPromise(store.write('doomed', 1));
    await Effect.runPromise(store.remove('doomed'));
    await expect(
      Effect.runPromise(store.read('doomed')),
    ).resolves.toBeUndefined();
  });

  it('keeps namespaces isolated', async () => {
    await Effect.runPromise(store.write('shared', 'a'));
    const other = makeLocalStorageUiPreferencesStore('other-ns');
    await expect(
      Effect.runPromise(other.read('shared')),
    ).resolves.toBeUndefined();
  });
});
