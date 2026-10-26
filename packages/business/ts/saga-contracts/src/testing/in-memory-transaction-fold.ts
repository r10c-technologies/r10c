import type { TransactionRecord } from '@entifix/transactions';
import { Effect } from 'effect';

import type { TransactionFoldSubject } from './transaction-fold.contract.js';

/**
 * A transaction fold held in memory, with the records it folds into, for the
 * specs of whatever consumes the port. It runs
 * `describeTransactionFoldContract`.
 */
export const makeInMemoryTransactionFold = (): TransactionFoldSubject => {
  const records = new Map<string, TransactionRecord>();
  const claims = new Set<string>();

  return {
    fold: {
      fold: (consumer, eventId, event) =>
        Effect.sync(() => {
          const claim = `${consumer}:${eventId}`;
          if (claims.has(claim)) return 'duplicate';
          claims.add(claim);
          const { transactionId, entity, state, at } = event;
          records.set(transactionId, {
            createdAt: at,
            ...records.get(transactionId),
            transactionId,
            entity,
            state,
            updatedAt: at,
            ...(event.organizationId === undefined
              ? {}
              : { organizationId: event.organizationId }),
            ...(event.code === undefined ? {} : { code: event.code }),
            ...(event.entityId === undefined ? {} : { entityId: event.entityId }),
            ...(event.error === undefined ? {} : { error: event.error }),
          });
          return 'claimed';
        }),
    },
    recordOf: transactionId => Promise.resolve(records.get(transactionId)),
  };
};
