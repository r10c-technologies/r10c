import { EntifixConnError } from '@entifix/core';
import { MongoClientTag } from '@entifix/mongo';
import {
  ensureInboxIndexes,
  makeMongoUnitsOfWork,
} from '@entifix/mongo/transactions';
import type { TransactionEvent } from '@entifix/transactions';
import { Context, Effect, Layer } from 'effect';

import {
  transactionFold,
  transactionsCollection,
} from './transaction-store.js';

/**
 * Fold one `transaction.*` event into the tracker's read model **exactly
 * once per consumer**: the event's claim and the record's upsert are one unit
 * of work, so a redelivery answers `duplicate` and writes nothing, and a
 * crash between the two cannot leave a record folded with no claim behind it.
 */
export interface TransactionFold {
  readonly fold: (
    consumer: string,
    eventId: string,
    event: TransactionEvent,
  ) => Effect.Effect<'claimed' | 'duplicate', EntifixConnError>;
}

/**
 * Declared here rather than in a business package because the `transaction`
 * slice declares no domain — there is no package of its own to hold a port.
 */
export class TransactionFoldTag extends Context.Service<
  TransactionFoldTag,
  TransactionFold
>()('TransactionFoldTag') {}

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
                  catch: error =>
                    new EntifixConnError(
                      'Failed to fold transaction event',
                      error,
                      { consumer, eventId },
                    ),
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
