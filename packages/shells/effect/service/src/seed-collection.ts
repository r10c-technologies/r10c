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

/**
 * Stamps the first revision on seed records of an entity that declares one.
 *
 * A seed inserts wire records verbatim, and a record with no `revision` can
 * never be updated: an update names the revision it read, and the stored one
 * has none to match (entifix 0032). Seed data is a *first save*, so it starts
 * at `1` — what `save` writes for a create. A record that states its own is
 * left as it is.
 */
export const revised = (
  data: ReadonlyArray<object>,
): ReadonlyArray<Record<string, unknown>> =>
  data.map(item => ({ revision: 1, ...item }));
