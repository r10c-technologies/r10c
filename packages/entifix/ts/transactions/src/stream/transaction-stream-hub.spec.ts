import type { DomainEvent, EntityChangeEvent } from '@r10c/entifix-ts-core';
import { Chunk, Effect, Stream } from 'effect';
import { describe, expect, it } from 'vitest';

import type { TransactionEvent, TransactionState } from '../contracts/event.js';
import {
  entityChangeFor,
  makeTransactionStreamHubEffect,
} from './transaction-stream-hub.js';

const event = (
  overrides: Partial<TransactionEvent> = {},
): DomainEvent<TransactionEvent> => {
  const data: TransactionEvent = {
    transactionId: 'txn-1',
    entity: 'product-specification',
    state: 'COMPLETED',
    step: 'completed',
    at: '2026-09-02T00:00:00.000Z',
    organizationId: 'org-1',
    ...overrides,
  };
  return {
    name: `transaction.${data.step}`,
    id: `${data.transactionId}:${data.step}`,
    source: 'marketplace-admin',
    at: data.at,
    correlationId: data.transactionId,
    data,
  };
};

describe('entityChangeFor', () => {
  it('keeps the message metadata rather than copying it onto the payload', () => {
    const change = entityChangeFor(event({ entityId: 'entity-9' }));

    expect(change.name).toBe('transaction.completed');
    expect(change.id).toBe('txn-1:completed');
    expect(change.source).toBe('marketplace-admin');
    expect(change.at).toBe('2026-09-02T00:00:00.000Z');
    expect(change.correlationId).toBe('txn-1');
    expect(change.data).toEqual({
      entity: 'product-specification',
      change: 'created',
      id: 'entity-9',
    });
  });

  it('falls back to the transaction id, which is the entity id for a create', () => {
    expect(entityChangeFor(event()).data.id).toBe('txn-1');
  });

  it.each<[TransactionState, string]>([
    ['PENDING', 'created'],
    ['COMPLETED', 'created'],
    ['FAILED', 'deleted'],
    ['STALE', 'deleted'],
  ])('maps %s onto %s', (state, change) => {
    expect(entityChangeFor(event({ state })).data.change).toBe(change);
  });
});

/** Reads `count` events off a connection, publishing `offered` behind it. */
const received = (
  organizationId: string,
  offered: readonly DomainEvent<TransactionEvent>[],
  count: number,
): Effect.Effect<readonly DomainEvent<EntityChangeEvent>[]> =>
  Effect.scoped(
    Effect.gen(function* () {
      const hub = yield* makeTransactionStreamHubEffect;
      const reading = yield* Effect.fork(
        Stream.runCollect(Stream.take(hub.subscribe(organizationId), count)),
      );
      // The subscriber attaches asynchronously; yield until it has.
      yield* Effect.yieldNow();
      yield* Effect.forEach(offered, event => hub.publish(event), {
        discard: true,
      });
      return Chunk.toReadonlyArray(yield* reading);
    }),
  );

describe('TransactionStreamHub', () => {
  it('delivers an event to a connection in the same organization', async () => {
    const [change] = await Effect.runPromise(
      received('org-1', [event({ entityId: 'entity-1' })], 1),
    );

    expect(change?.data.id).toBe('entity-1');
  });

  it('never delivers another organization’s event', async () => {
    const [change] = await Effect.runPromise(
      received(
        'org-1',
        [
          event({ organizationId: 'org-2', entityId: 'foreign' }),
          event({ entityId: 'mine' }),
        ],
        1,
      ),
    );

    expect(change?.data.id).toBe('mine');
  });

  it('fails closed: an event carrying no organization reaches nobody', async () => {
    const [change] = await Effect.runPromise(
      received(
        'org-1',
        [
          event({ organizationId: undefined, entityId: 'unscoped' }),
          event({ entityId: 'mine' }),
        ],
        1,
      ),
    );

    expect(change?.data.id).toBe('mine');
  });
});
