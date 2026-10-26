import { makeInMemoryPublishedCatalog } from './in-memory-published-catalog.js';
import { describePublishedCatalogContract } from './published-catalog.contract.js';

describePublishedCatalogContract(
  'the in-memory projection',
  makeInMemoryPublishedCatalog,
);
