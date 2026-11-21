import { Effect } from 'effect';

import {
  isObjectKey,
  type ObjectBytes,
  type ObjectStore,
} from '../object-store';

interface Entry extends ObjectBytes {
  readonly writtenAt: Date;
}

/**
 * An object store in a `Map`, for a flow's spec. `now` dates each write, so a
 * spec can age an object past a sweep's grace without waiting.
 */
export const makeInMemoryObjectStore = (
  now: () => Date = () => new Date(),
): ObjectStore & { readonly keys: () => readonly string[] } => {
  const objects = new Map<string, Entry>();
  const checked = (key: string) =>
    isObjectKey(key)
      ? Effect.void
      : Effect.die(new Error(`not an object key: '${key}'`));
  return {
    put: (key, bytes, contentType) =>
      Effect.andThen(checked(key), () =>
        Effect.sync(() => {
          objects.set(key, {
            bytes: bytes.slice(),
            contentType,
            writtenAt: now(),
          });
        }),
      ),
    get: key =>
      Effect.andThen(checked(key), () =>
        Effect.sync(() => {
          const entry = objects.get(key);
          return entry === undefined
            ? undefined
            : { bytes: entry.bytes.slice(), contentType: entry.contentType };
        }),
      ),
    delete: key =>
      Effect.andThen(checked(key), () =>
        Effect.sync(() => {
          objects.delete(key);
        }),
      ),
    list: (prefix, olderThan) =>
      Effect.sync(() =>
        Array.from(objects.entries())
          .filter(
            ([key, entry]) =>
              key.startsWith(prefix) && entry.writtenAt < olderThan,
          )
          .map(([key, entry]) => ({ key, writtenAt: entry.writtenAt }))
          .sort((a, b) => a.key.localeCompare(b.key)),
      ),
    keys: () => Array.from(objects.keys()).sort(),
  };
};
