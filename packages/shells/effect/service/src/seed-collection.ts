import { Effect } from 'effect';
import type { Db } from 'mongodb';

/**
 * Inserts a seed dataset into a collection when, and only when, it is empty.
 *
 * Per **collection** rather than per database: a store that gains a second
 * collection later seeds that one on the next boot instead of staying empty
 * because the first one has rows. It never rewrites a row — a changed seed
 * reaches a lab through `<app>:dev:reset`, which is the rule for every seed in
 * the fleet.
 */
export const seedCollection = (
  db: Db,
  collectionName: string,
  data: ReadonlyArray<object>,
) =>
  Effect.gen(function* () {
    const collection = db.collection(collectionName);
    const count = yield* Effect.promise(() => collection.countDocuments());
    if (count === 0 && data.length > 0) {
      yield* Effect.promise(() =>
        collection.insertMany(data.map(item => ({ ...item }))),
      );
    }
  });
