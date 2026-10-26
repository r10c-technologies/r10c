import { mongoSagaStoreLayer } from '@entifix/mongo/transactions';
import {
  mongoTransactionFoldLayer,
  mongoTransactionStoreLayer,
} from '@r10c/implementation-saga-mongo';
import { Layer } from 'effect';

/**
 * The `saga` store's three handles over the one database this slice names:
 * the instances the coordinator walks (entifix's), and the tracker's read
 * model and its exactly-once fold (the `saga/mongo` cell's). One function, so
 * the composition root and the e2e mock cannot name the database twice.
 */
export const sagaStoresLayer = (database: string) =>
  Layer.mergeAll(
    mongoSagaStoreLayer({ database }),
    mongoTransactionStoreLayer({ database }),
    mongoTransactionFoldLayer({ database }),
  );
