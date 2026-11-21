import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ObjectStore } from '../object-store';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/**
 * What every `ObjectStore` adapter must do
 * ([ADR 0063](../../../../../../docs/adr/0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)).
 * `make` answers a fresh, empty store; `age` makes everything written so far
 * older than any `olderThan` a spec passes after it, however the adapter dates
 * a write.
 */
export const describeObjectStoreContract = (
  name: string,
  make: () => Promise<{
    readonly store: ObjectStore;
    readonly age: () => Promise<void>;
  }>,
) =>
  describe(`${name} (ObjectStore contract)`, () => {
    it('reads back the bytes and the type it wrote', async () => {
      const { store } = await make();
      await run(store.put('evidence/o-1/a', PNG, 'image/png'));

      expect(await run(store.get('evidence/o-1/a'))).toEqual({
        bytes: PNG,
        contentType: 'image/png',
      });
    });

    it('answers nothing for a key never written, and replaces on a rewrite', async () => {
      const { store } = await make();
      expect(await run(store.get('evidence/none'))).toBeUndefined();

      await run(store.put('evidence/o-1/a', PNG, 'image/png'));
      await run(
        store.put('evidence/o-1/a', new Uint8Array([1]), 'application/pdf'),
      );

      expect(await run(store.get('evidence/o-1/a'))).toEqual({
        bytes: new Uint8Array([1]),
        contentType: 'application/pdf',
      });
    });

    it('deletes, and deleting what is gone still succeeds', async () => {
      const { store } = await make();
      await run(store.put('evidence/o-1/a', PNG, 'image/png'));

      await run(store.delete('evidence/o-1/a'));
      await run(store.delete('evidence/o-1/a'));

      expect(await run(store.get('evidence/o-1/a'))).toBeUndefined();
    });

    it('lists what sits under a prefix and was written before the cut', async () => {
      const { store, age } = await make();
      await run(store.put('evidence/o-1/a', PNG, 'image/png'));
      await run(store.put('other/o-1/b', PNG, 'image/png'));
      await age();
      const cut = new Date();
      // A filesystem dates a write to its own clock's resolution: let it move.
      await new Promise(resolve => setTimeout(resolve, 25));
      await run(store.put('evidence/o-2/c', PNG, 'image/png'));

      const listed = await run(store.list('evidence/', cut));

      expect(listed.map(object => object.key)).toEqual(['evidence/o-1/a']);
      expect(listed[0]?.writtenAt).toBeInstanceOf(Date);
    });

    it('refuses a key that could leave the store', async () => {
      const { store } = await make();
      for (const key of ['../escape', 'evidence/../x', '/abs', 'a//b', 'a b'])
        expect(
          Exit.isFailure(
            await Effect.runPromiseExit(store.put(key, PNG, 'image/png')),
          ),
        ).toBe(true);
    });
  });
