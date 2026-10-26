import { describeConfigurationLookupContract } from './configuration-lookup.contract.js';
import { makeInMemoryConfigurationLookup } from './in-memory-configuration-lookup.js';

describeConfigurationLookupContract(
  'the in-memory lookup',
  makeInMemoryConfigurationLookup,
);
