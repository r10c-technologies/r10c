import type { TransitionalFailure } from '@entifix/core';
import type { TransactionEvent } from '@entifix/transactions';
import { Context, type Effect } from 'effect';

/**
 * The tracker's exactly-once fold of a transaction event into the `saga`
 * store's read model: `claimed` the first time an event is delivered to a
 * consumer, `duplicate` on every redelivery, which folds nothing.
 */
export interface TransactionFold {
  readonly fold: (
    consumer: string,
    eventId: string,
    event: TransactionEvent,
  ) => Effect.Effect<'claimed' | 'duplicate', TransitionalFailure>;
}

export class TransactionFoldTag extends Context.Service<
  TransactionFoldTag,
  TransactionFold
>()('TransactionFoldTag') {}
