import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductSpecification } from '../entities/product-specification/product-specification.entity.js';
import {
  makeInMemoryOfferingCatalog,
  makeInMemorySpecificationCommands,
} from './in-memory-catalog.js';
import {
  CONTRACT_OFFERINGS,
  CONTRACT_PRICES,
  describeOfferingCatalogContract,
} from './offering-catalog.contract.js';
import { describeSpecificationCommandsContract } from './specification-commands.contract.js';

describeOfferingCatalogContract('the in-memory catalog', () =>
  makeInMemoryOfferingCatalog(CONTRACT_OFFERINGS, CONTRACT_PRICES),
);
describeSpecificationCommandsContract(
  'the in-memory commands',
  makeInMemorySpecificationCommands,
);

describe('the in-memory commands, seeded', () => {
  it('moves a seeded version from where the seed says it stands', async () => {
    const commands = makeInMemorySpecificationCommands({
      acme: [
        {
          id: 's-1',
          specKey: 'product-001',
          version: 1,
          lifecycleStatus: 'active',
        },
      ],
    });
    const retired = Object.assign(new ProductSpecification(), {
      id: 's-1',
      specKey: 'product-001',
      lifecycleStatus: 'retired',
      revision: 1,
    });

    expect(
      await Effect.runPromise(commands.move('acme', retired, 'active')),
    ).toBe('committed');
    expect(retired.revision).toBe(2);
  });
});
