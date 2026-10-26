import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { seedCollection } from './seed-collection.js';

describe('seedCollection', () => {
  it('fills an empty collection', async () => {
    const fake = makeFakeMongoDb();

    await Effect.runPromise(
      seedCollection(fake.db as Db, 'widget', [{ id: 'w-1' }, { id: 'w-2' }]),
    );

    expect(fake.read('widget')).toHaveLength(2);
  });

  it('leaves a collection that already has rows alone, and writes nothing for an empty seed', async () => {
    const fake = makeFakeMongoDb({ widget: [{ id: 'kept' }] });

    await Effect.runPromise(
      seedCollection(fake.db as Db, 'widget', [{ id: 'new' }]),
    );
    await Effect.runPromise(seedCollection(fake.db as Db, 'other', []));

    expect(fake.read('widget')).toEqual([{ id: 'kept' }]);
    expect(fake.read('other')).toEqual([]);
  });
});
