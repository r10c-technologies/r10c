import { makeInMemoryPublishedVendors } from './in-memory-published-vendors.js';
import { describePublishedVendorsContract } from './published-vendors.contract.js';

describePublishedVendorsContract(
  'the in-memory projection',
  makeInMemoryPublishedVendors,
);
