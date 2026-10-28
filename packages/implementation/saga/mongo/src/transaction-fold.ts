import { Unavailable } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  ensureInboxIndexes,
  makeMongoUnitsOfWork,
} from '@entifix/mongo/transactions';
import { TransactionFoldTag } from '@r10c/business-ts-saga-contracts';
import { Effect, Layer } from 'effect';

import {
  transactionFold,
  transactionsCollection,
} from './transaction-store.js';

export const mongoTransactionFoldLayer = (options: {
  readonly database: string;
}) =>
  Layer.effect(
    TransactionFoldTag,
    Effect.gen(function* () {
      const client = yield* MongoClientTag;
      const db = client.db(options.database);
      // The claim's unique index is the exactly-once guarantee, so it exists
      // before the first delivery rather than after it.
      yield* ensureInboxIndexes(db);
      const units = makeMongoUnitsOfWork(client).forDatabase(db);

      return {
        fold: (consumer, eventId, event) =>
          Effect.map(
            units.run(
              unit =>
                Effect.tryPromise({
                  try: () => {
                    const { filter, update } = transactionFold(event);
                    return transactionsCollection(unit.handle.db).updateOne(
                      filter,
                      update,
                      { upsert: true, session: unit.handle.session },
                    );
                  },
                  catch: () => new Unavailable({ dependency: 'mongo' }),
                }),
              { claim: { kind: 'event', consumer, eventId } },
            ),
            outcome =>
              outcome._tag === 'duplicate'
                ? ('duplicate' as const)
                : ('claimed' as const),
          ),
      };
    }),
  );
