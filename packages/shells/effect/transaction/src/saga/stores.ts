import { mongoSagaStoreLayer } from '@entifix/mongo/transactions';

/**
 * The `saga` store over the one database this slice names: the instances the
 * coordinator walks. One function, so the composition root and the e2e mock
 * cannot name the database twice.
 */
export const sagaStoresLayer = (database: string) =>
  mongoSagaStoreLayer({ database });
