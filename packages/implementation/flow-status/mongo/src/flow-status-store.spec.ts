import { isStoreFault } from '@entifix/core';
import {
  type FlowStatusStore,
  FlowStatusStoreTag,
} from '@r10c/business-ts-flow-contracts';
import {
  contractFlowStatus,
  describeFlowStatusStoreContract,
} from '@r10c/business-ts-flow-contracts/testing';
import { mongoCellWorld } from '@r10c/testing-cells/mongo';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  FLOW_STATUS_COLLECTION,
  MongoFlowStatusStoreLayer,
} from './flow-status-store.js';

const world = () => {
  const cell = mongoCellWorld(MongoFlowStatusStoreLayer({ ttlSeconds: 600 }), {
    source: 'realtime',
  });
  const run = <A, E>(use: (store: FlowStatusStore) => Effect.Effect<A, E>) =>
    cell.run(Effect.flatMap(FlowStatusStoreTag, use));
  return { ...cell, run };
};

describeFlowStatusStoreContract('the Mongo cell', world);

describe('the Mongo cell', () => {
  it('indexes one record per flow, and retires it after the TTL dial', async () => {
    const { fake, run } = world();
    await run(() => Effect.void);

    expect(
      fake.operations.filter(
        operation =>
          operation.collection === FLOW_STATUS_COLLECTION &&
          operation.op === 'createIndex',
      ),
    ).toHaveLength(2);
  });

  it('keeps one record when the same message is applied in parallel', async () => {
    const { fake, run } = world();
    const record = contractFlowStatus('f-burst', 3, { state: 'completed' });
    const claim = { consumer: 'realtime.flow.completed', eventId: 'f-burst:3' };

    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () => run(store => store.apply(record, claim))),
    );

    expect(outcomes.filter(outcome => outcome === 'applied')).toHaveLength(1);
    expect(fake.read(FLOW_STATUS_COLLECTION)).toHaveLength(1);
  });

  it('stores no member the record does not carry', async () => {
    const { fake, run } = world();
    const record = contractFlowStatus('f-bare', 1);
    delete (record as { step?: string }).step;
    await run(store => store.apply(record, { consumer: 'c', eventId: 'e' }));

    expect(fake.read(FLOW_STATUS_COLLECTION)[0]).not.toHaveProperty('step');
    expect(await run(store => store.read('f-bare'))).toEqual(record);
  });

  it('answers a driver failure as a store fault', async () => {
    const { fake, run } = world();

    for (const [operation, use] of [
      ['findOne', (store: FlowStatusStore) => Effect.asVoid(store.read('f-1'))],
      [
        'find',
        (store: FlowStatusStore) => Effect.asVoid(store.readMany(['f-1'])),
      ],
      [
        'findOne',
        (store: FlowStatusStore) =>
          Effect.asVoid(
            store.apply(contractFlowStatus('f-1', 1), {
              consumer: 'c',
              eventId: 'e',
            }),
          ),
      ],
    ] as const) {
      // Failing once the store is built, so the indexes are not what fails.
      const failure = await run(store =>
        Effect.sync(() =>
          fake.failOnce(operation, new Error('connection reset')),
        ).pipe(Effect.andThen(Effect.flip(use(store)))),
      );
      expect(isStoreFault(failure)).toBe(true);
    }
  });
});
