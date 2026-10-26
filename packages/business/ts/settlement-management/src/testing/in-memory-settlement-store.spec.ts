import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Agreement } from '../entities/agreement/index.js';
import { makeInMemorySettlementStore } from './in-memory-settlement-store.js';
import {
  CONTRACT_AGREEMENTS,
  describeSettlementStoreContract,
} from './settlement-store.contract.js';

describeSettlementStoreContract('the in-memory store', () =>
  makeInMemorySettlementStore(CONTRACT_AGREEMENTS),
);

describe('the in-memory store beyond the contract', () => {
  it('ranks an agreement with no start date below any dated one', async () => {
    const undated = Object.assign(new Agreement('v-1', 900), { id: 'undated' });
    const dated = Object.assign(new Agreement('v-1', 1000), {
      id: 'dated',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });

    const agreements = await Effect.runPromise(
      makeInMemorySettlementStore([undated, dated, undated]).join.agreementsFor(
        ['v-1'],
      ),
    );

    expect(agreements.get('v-1')?.id).toBe('dated');
  });
});
