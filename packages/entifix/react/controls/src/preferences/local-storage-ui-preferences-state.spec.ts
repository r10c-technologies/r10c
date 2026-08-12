import { Effect, Exit } from 'effect';

import {
  LocalStorageUiPreferencesLayer,
  makeLocalStorageUiPreferencesState,
} from './local-storage-ui-preferences-state';
import {
  type UiPreferencesState,
  UiPreferencesStateTag,
} from './ui-preferences-state';

describe('makeLocalStorageUiPreferencesState', () => {
  const store = makeLocalStorageUiPreferencesState('test-ns');

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
    const other = makeLocalStorageUiPreferencesState('other-ns');
    await expect(
      Effect.runPromise(other.read('shared')),
    ).resolves.toBeUndefined();
  });
});

describe('the store as an Effect service', () => {
  it('is provided by the layer under its tag', async () => {
    const store = await Effect.runPromise(
      Effect.provide(UiPreferencesStateTag, LocalStorageUiPreferencesLayer),
    );

    await Effect.runPromise(store.write('entity-table:product', { order: ['id'] }));

    expect(
      await Effect.runPromise(store.read('entity-table:product')),
    ).toEqual({ order: ['id'] });
  });
});

// Every method reports the failure rather than throwing, so a control can
// decide to fall back to defaults instead of the render crashing.
describe('when localStorage misbehaves', () => {
  const brokenStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota exceeded');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };

  const withBrokenStorage = (run: () => Promise<void>) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: brokenStorage,
      configurable: true,
      writable: true,
    });
    return run().finally(() => {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    });
  };

  it.each([
    ['read', (store: UiPreferencesState) => store.read('k')],
    ['write', (store: UiPreferencesState) => store.write('k', 1)],
    ['remove', (store: UiPreferencesState) => store.remove('k')],
  ])('fails %s with EntifixConnError', async (_label, run) =>
    withBrokenStorage(async () => {
      const store = makeLocalStorageUiPreferencesState();

      const exit = await Effect.runPromiseExit(run(store));

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});

// There is no `window.localStorage` during SSR. Rather than failing, reads
// resolve empty and writes are dropped, so a control renders its defaults on
// the server and picks up the stored value after hydration.
describe('without localStorage (server rendering)', () => {
  const withoutStorage = async (run: () => Promise<void>) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      await run();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  };

  it('resolves a read as empty', async () =>
    withoutStorage(async () => {
      const ssrStore = makeLocalStorageUiPreferencesState('test-ns');

      expect(await Effect.runPromise(ssrStore.read('k'))).toBeUndefined();
    }));

  it.each([
    ['write', (s: UiPreferencesState) => s.write('k', 1)],
    ['remove', (s: UiPreferencesState) => s.remove('k')],
  ])('drops a %s without failing', async (_label, run) =>
    withoutStorage(async () => {
      const ssrStore = makeLocalStorageUiPreferencesState('test-ns');

      expect(Exit.isSuccess(await Effect.runPromiseExit(run(ssrStore)))).toBe(true);
    }),
  );
});
