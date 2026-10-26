import {
  makeInMemoryOfferingCatalog,
  makeInMemorySpecificationCommands,
} from './in-memory-catalog.js';
import {
  CONTRACT_OFFERINGS,
  describeOfferingCatalogContract,
} from './offering-catalog.contract.js';
import { describeSpecificationCommandsContract } from './specification-commands.contract.js';

describeOfferingCatalogContract('the in-memory catalog', () =>
  makeInMemoryOfferingCatalog(CONTRACT_OFFERINGS),
);
describeSpecificationCommandsContract(
  'the in-memory commands',
  makeInMemorySpecificationCommands,
);
