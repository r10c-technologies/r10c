import { makeInMemoryShippingOrderStore } from './in-memory-shipping-order-store.js';
import { describeShippingOrderStoreContract } from './shipping-order-store.contract.js';

describeShippingOrderStoreContract(
  'the in-memory store',
  makeInMemoryShippingOrderStore,
);
