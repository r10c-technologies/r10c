import { MongoClientTag } from '@entifix/mongo';
import { describeSagaStoreContract } from '@entifix/testing-unit/contracts';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { SagaStoreTag } from '@entifix/transactions';
import { Effect, Layer } from 'effect';

import { sagaStoresLayer } from './stores.js';

/**
 * The instance store the coordinator walks, as this slice composes it over
 * its one named database — not entifix's constant layer, which entifix
 * already holds to the contract.
 */
describeSagaStoreContract('the transaction slice’s saga store', () => {
  const fake = makeFakeMongoDb();
  const client = {
    db: () => fake.db,
    startSession: (...args: unknown[]) =>
      (fake.startSession as (...a: unknown[]) => unknown)(...args),
  };
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* SagaStoreTag;
    }).pipe(
      Effect.provide(
        sagaStoresLayer('transaction_manager').pipe(
          Layer.provide(Layer.succeed(MongoClientTag, client as never)),
        ),
      ),
    ),
  );
});
