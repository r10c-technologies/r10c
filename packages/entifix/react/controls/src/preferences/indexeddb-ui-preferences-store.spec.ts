import 'fake-indexeddb/auto';

import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  IndexedDbUiPreferencesLayer,
  makeIndexedDbUiPreferencesStore,
} from './indexeddb-ui-preferences-store.js';
import { UiPreferencesStoreTag } from './ui-preferences-store.js';

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe('makeIndexedDbUiPreferencesStore', () => {
  it('round-trips a written value', async () => {
    const store = makeIndexedDbUiPreferencesStore();

    await run(store.write('round-trip', { collapsed: true, order: [1, 2] }));
    const value = await run(store.read<{ collapsed: boolean; order: number[] }>('round-trip'));

    expect(value).toEqual({ collapsed: true, order: [1, 2] });
  });

  it('reads undefined for a missing key', async () => {
    const store = makeIndexedDbUiPreferencesStore();

    expect(await run(store.read('never-written'))).toBeUndefined();
  });

  it('removes a value', async () => {
    const store = makeIndexedDbUiPreferencesStore();

    await run(store.write('to-remove', 'x'));
    await run(store.remove('to-remove'));

    expect(await run(store.read('to-remove'))).toBeUndefined();
  });

  it('namespaces keys so two namespaces do not collide', async () => {
    const a = makeIndexedDbUiPreferencesStore('ns-a');
    const b = makeIndexedDbUiPreferencesStore('ns-b');

    await run(a.write('shared', 'from-a'));
    await run(b.write('shared', 'from-b'));

    expect(await run(a.read('shared'))).toBe('from-a');
    expect(await run(b.read('shared'))).toBe('from-b');
  });

  it('fails with EntifixConnError when the value cannot be stored', async () => {
    const store = makeIndexedDbUiPreferencesStore();

    // A function is not structured-cloneable → the put rejects.
    const exit = await Effect.runPromiseExit(
      store.write('bad', () => undefined),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = exit.cause._tag === 'Fail' ? exit.cause.error : undefined;
      expect(error).toBeInstanceOf(EntifixConnError);
    }
  });

  describe('without IndexedDB (SSR)', () => {
    it('resolves reads empty and drops writes/removes', async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error — simulate a server environment.
      delete globalThis.indexedDB;
      try {
        const store = makeIndexedDbUiPreferencesStore();
        await run(store.write('ssr', 'ignored'));
        await run(store.remove('ssr'));
        expect(await run(store.read('ssr'))).toBeUndefined();
      } finally {
        globalThis.indexedDB = original;
      }
    });
  });
});

describe('IndexedDbUiPreferencesLayer', () => {
  it('provides a working store through the tag', async () => {
    const program = Effect.gen(function* () {
      const store = yield* UiPreferencesStoreTag;
      yield* store.write('via-layer', 42);
      return yield* store.read<number>('via-layer');
    });

    const value = await run(Effect.provide(program, IndexedDbUiPreferencesLayer));

    expect(value).toBe(42);
  });
});
