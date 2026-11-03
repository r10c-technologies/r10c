import { makeInMemoryOrderStores } from './in-memory-product-order-store.js';
import { describeProductOrderStoreContract } from './product-order-store.contract.js';

describeProductOrderStoreContract(
  'the in-memory stores',
  makeInMemoryOrderStores,
);
