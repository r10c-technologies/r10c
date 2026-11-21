import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { Unavailable } from '@entifix/core';
import {
  isObjectKey,
  type ObjectStore,
  type StoredObject,
} from '@r10c/business-ts-object-storage';
import { Effect } from 'effect';

/**
 * The lab's object store: a directory
 * ([ADR 0081](../../../../../docs/adr/0081-an-order-waits-for-a-payment-the-seller-confirms-and-a-receipt-is-a-file.md) §8).
 * No MinIO and no health-ladder rung — the lab is recreated on demand, and
 * `dev:reset` empties the directory with everything else.
 *
 * An object's bytes live under `data/<key>` and the type it was written as
 * under `type/<key>`, so no key can collide with its own metadata. A write
 * replaces the type before the bytes: a reader that races it sees the old
 * bytes or the new, each under a type a browser was told about.
 */
export const makeFsObjectStore = (root: string): ObjectStore => {
  const dependency = 'payment-evidence';
  const fault = () => new Unavailable({ dependency });
  const dataOf = (key: string) => join(root, 'data', key);
  const typeOf = (key: string) => join(root, 'type', key);
  const keyed = <A>(key: string, run: () => Promise<A>) =>
    isObjectKey(key)
      ? Effect.tryPromise({ try: run, catch: fault })
      : Effect.die(new Error(`not an object key: '${key}'`));
  const missing = (error: unknown) =>
    (error as NodeJS.ErrnoException).code === 'ENOENT';
  const write = async (path: string, content: Uint8Array | string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const walk = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (missing(error)) return [];
        throw error;
      },
    );
    const nested = await Promise.all(
      entries.map(entry =>
        entry.isDirectory()
          ? walk(join(directory, entry.name))
          : Promise.resolve([join(directory, entry.name)]),
      ),
    );
    return nested.flat();
  };

  return {
    put: (key, bytes, contentType) =>
      keyed(key, async () => {
        await write(typeOf(key), contentType);
        await write(dataOf(key), bytes);
      }),
    get: key =>
      keyed(key, async () => {
        try {
          const [bytes, contentType] = await Promise.all([
            readFile(dataOf(key)),
            readFile(typeOf(key), 'utf8'),
          ]);
          return { bytes: new Uint8Array(bytes), contentType };
        } catch (error) {
          if (missing(error)) return undefined;
          throw error;
        }
      }),
    delete: key =>
      keyed(key, async () => {
        await rm(dataOf(key), { force: true });
        await rm(typeOf(key), { force: true });
      }),
    list: (prefix, olderThan) =>
      Effect.tryPromise({
        try: async () => {
          const data = join(root, 'data');
          const listed: StoredObject[] = [];
          for (const path of await walk(data)) {
            const key = relative(data, path).split(sep).join('/');
            if (!key.startsWith(prefix)) continue;
            const { mtime } = await stat(path);
            if (mtime < olderThan) listed.push({ key, writtenAt: mtime });
          }
          return listed.sort((a, b) => a.key.localeCompare(b.key));
        },
        catch: fault,
      }),
  };
};
