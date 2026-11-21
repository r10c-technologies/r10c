import { chmod, mkdtemp, readdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describeObjectStoreContract } from '@r10c/business-ts-object-storage/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeFsObjectStore } from './fs-object-store.js';

const fresh = () => mkdtemp(join(tmpdir(), 'r10c-objects-'));

/** Backdate every file under `directory` an hour. */
const backdate = async (directory: string): Promise<void> => {
  const past = new Date(Date.now() - 3_600_000);
  for (const entry of await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  }))
    if (entry.isFile())
      await utimes(join(entry.parentPath, entry.name), past, past);
};

describeObjectStoreContract('the filesystem object store', async () => {
  const root = await fresh();
  return { store: makeFsObjectStore(root), age: () => backdate(root) };
});

describe('the filesystem object store', () => {
  it('lists nothing from a directory nothing was written to', async () => {
    const store = makeFsObjectStore(join(await fresh(), 'never'));

    expect(await Effect.runPromise(store.list('', new Date()))).toEqual([]);
  });

  it('lists by key, whatever order the directory walk found them in', async () => {
    const root = await fresh();
    const store = makeFsObjectStore(root);
    for (const key of ['evidence/b/2', 'evidence/a/1'])
      await Effect.runPromise(store.put(key, new Uint8Array([1]), 'image/png'));
    await backdate(root);

    const listed = await Effect.runPromise(store.list('evidence/', new Date()));

    expect(listed.map(object => object.key)).toEqual([
      'evidence/a/1',
      'evidence/b/2',
    ]);
  });

  it('answers unavailable when the directory cannot be read or written', async () => {
    const root = await fresh();
    // A file where the store's directory should be.
    await writeFile(join(root, 'data'), 'not a directory');
    const store = makeFsObjectStore(root);

    for (const effect of [
      store.put('k', new Uint8Array(), 'image/png'),
      store.get('k'),
      store.list('', new Date()),
    ]) {
      const exit = await Effect.runPromiseExit(
        effect as Effect.Effect<unknown, unknown>,
      );
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain(
        'Unavailable',
      );
    }
  });

  it('answers unavailable when a file it holds cannot be read', async () => {
    const root = await fresh();
    const store = makeFsObjectStore(root);
    await Effect.runPromise(store.put('k', new Uint8Array([1]), 'image/png'));
    await chmod(join(root, 'data', 'k'), 0o000);

    const exit = await Effect.runPromiseExit(store.get('k'));

    expect(Exit.isFailure(exit)).toBe(true);
  });
});
