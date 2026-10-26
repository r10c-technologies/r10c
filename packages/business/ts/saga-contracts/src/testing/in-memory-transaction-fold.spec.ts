import { makeInMemoryTransactionFold } from './in-memory-transaction-fold.js';
import { describeTransactionFoldContract } from './transaction-fold.contract.js';

describeTransactionFoldContract(
  'the in-memory fold',
  makeInMemoryTransactionFold,
);
