import { Storage } from '@google-cloud/storage';
import { describeObjectStoreContract } from '@r10c/business-ts-object-storage/testing';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type GcsBucket,
  gcsBucketOf,
  type GcsFile,
  makeBucketObjectStore,
  makeGcsObjectStore,
} from './gcs-object-store.js';

interface Stored {
  bytes: Uint8Array;
  contentType: string;
  timeCreated: string;
}

/**
 * A bucket in a `Map`, answering the way the API does: a missing object is a
 * 404 on read, and a delete told to ignore one succeeds.
 */
const fakeBucket = (now: () => Date) => {
  const objects = new Map<string, Stored>();
  const notFound = () =>
    Object.assign(new Error('No such object'), { code: 404 });
  const fileOf = (name: string): GcsFile => ({
    name,
    get metadata() {
      return { timeCreated: objects.get(name)?.timeCreated };
    },
    save: async (bytes, { contentType }) => {
      objects.set(name, {
        bytes: bytes.slice(),
        contentType,
        timeCreated: now().toISOString(),
      });
    },
    download: async () => {
      const stored = objects.get(name);
      if (stored === undefined) throw notFound();
      return [stored.bytes.slice()];
    },
    getMetadata: async () => {
      const stored = objects.get(name);
      if (stored === undefined) throw notFound();
      return [{ contentType: stored.contentType }];
    },
    delete: async () => {
      objects.delete(name);
    },
  });
  const bucket: GcsBucket = {
    file: fileOf,
    getFiles: async ({ prefix }) => [
      [...objects.keys()].filter(name => name.startsWith(prefix)).map(fileOf),
    ],
  };
  return { bucket, objects };
};

let clock = new Date();

describeObjectStoreContract('the Cloud Storage object store', async () => {
  clock = new Date(Date.now() - 60_000);
  return {
    store: makeGcsObjectStore(fakeBucket(() => clock).bucket),
    age: async () => {
      clock = new Date(Date.now() + 60_000);
    },
  };
});

const failing = (error: unknown): GcsBucket => ({
  file: name => ({
    name,
    metadata: {},
    save: () => Promise.reject(error),
    download: () => Promise.reject(error),
    getMetadata: () => Promise.reject(error),
    delete: () => Promise.reject(error),
  }),
  getFiles: () => Promise.reject(error),
});

describe('the Cloud Storage object store', () => {
  it('answers unavailable for anything the bucket refuses but a missing object', async () => {
    const store = makeGcsObjectStore(
      failing(Object.assign(new Error(), { code: 503 })),
    );

    for (const effect of [
      store.put('k', new Uint8Array(), 'image/png'),
      store.get('k'),
      store.delete('k'),
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

  it('reads an object with no type as bytes, and one with no creation stamp as old', async () => {
    const { bucket, objects } = fakeBucket(() => new Date());
    objects.set('evidence/a', {
      bytes: new Uint8Array([1]),
      contentType: undefined as never,
      timeCreated: undefined as never,
    });
    const store = makeGcsObjectStore(bucket);

    expect(await Effect.runPromise(store.get('evidence/a'))).toEqual({
      bytes: new Uint8Array([1]),
      contentType: 'application/octet-stream',
    });
    expect(
      await Effect.runPromise(store.list('evidence/', new Date(1))),
    ).toEqual([{ key: 'evidence/a', writtenAt: new Date(0) }]);
  });

  it('lists by key, and takes a real bucket as its driver', async () => {
    const { bucket } = fakeBucket(() => new Date(0));
    const store = makeGcsObjectStore(bucket);
    for (const key of ['evidence/b', 'evidence/a'])
      await Effect.runPromise(store.put(key, new Uint8Array([1]), 'image/png'));

    const listed = await Effect.runPromise(store.list('', new Date()));

    expect(listed.map(object => object.key)).toEqual([
      'evidence/a',
      'evidence/b',
    ]);
    const real = gcsBucketOf(new Storage({ projectId: 'spec' }).bucket('b'));
    expect(typeof real.file).toBe('function');
    expect(typeof makeBucketObjectStore('b').put).toBe('function');
  });
});
