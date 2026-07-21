import type { TransactionEvent } from '@r10c/entifix-transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  describeEventBusContract,
  describeLockServiceContract,
  describeSequenceServiceContract,
} from '../contracts/transaction-ports.contract';
import { runFailure } from '../effect/run';
import {
  makeInMemoryLockService,
  makeInMemorySequenceService,
  makeRecordingEventBus,
} from './transaction-ports';

describeLockServiceContract('in-memory fake', makeInMemoryLockService);
describeSequenceServiceContract('in-memory fake', makeInMemorySequenceService);
describeEventBusContract('recording fake', () => {
  const bus = makeRecordingEventBus();
  return {
    bus,
    deliver: (event) => Effect.runPromise(bus.deliver(event)),
    published: () => bus.published,
  };
});

describe('makeInMemoryLockService', () => {
  it('reports which keys are held', async () => {
    const locks = makeInMemoryLockService();

    await Effect.runPromise(locks.acquire('a'));
    await Effect.runPromise(locks.acquire('b'));

    expect(locks.held).toEqual(['a', 'b']);
  });

  it('records acquire and release in order, so the facade can be checked', async () => {
    const locks = makeInMemoryLockService();
    const handle = await Effect.runPromise(locks.acquire('code'));

    await Effect.runPromise(locks.release(handle));

    expect(locks.log).toEqual([
      { action: 'acquire', key: 'code' },
      { action: 'release', key: 'code' },
    ]);
  });

  it('fails acquisition on a key marked contended', async () => {
    const locks = makeInMemoryLockService();
    locks.contendOn('busy');

    const error = await runFailure(locks.acquire('busy'));

    expect(String(error)).toContain('busy');
  });
});

describe('makeInMemorySequenceService', () => {
  it('exposes the value each sequence has reached', async () => {
    const sequences = makeInMemorySequenceService();

    await Effect.runPromise(sequences.next('product'));
    await Effect.runPromise(sequences.next('product'));

    expect(sequences.values).toEqual({ product: 2 });
  });
});

describe('makeRecordingEventBus', () => {
  const anEvent = (transactionId: string): TransactionEvent => ({
    transactionId,
    entity: 'widget',
    state: 'PENDING',
    step: 'accepted',
    at: '2026-01-01T00:00:00.000Z',
  });

  it('fans a delivery out to every subscriber', async () => {
    const bus = makeRecordingEventBus();
    const first: string[] = [];
    const second: string[] = [];
    await Effect.runPromise(
      bus.subscribe((event) =>
        Effect.sync(() => {
          first.push(event.transactionId);
        }),
      ),
    );
    await Effect.runPromise(
      bus.subscribe((event) =>
        Effect.sync(() => {
          second.push(event.transactionId);
        }),
      ),
    );

    await Effect.runPromise(bus.deliver(anEvent('tx-1')));

    expect(first).toEqual(['tx-1']);
    expect(second).toEqual(['tx-1']);
  });

  it('fails one publish on demand, then recovers', async () => {
    const bus = makeRecordingEventBus();
    bus.failNextPublish();

    await runFailure(bus.publish(anEvent('tx-1')));
    await Effect.runPromise(bus.publish(anEvent('tx-2')));

    expect(bus.published.map((event) => event.transactionId)).toEqual(['tx-2']);
  });

  it('surfaces a handler failure to the caller of deliver', async () => {
    const bus = makeRecordingEventBus();
    await Effect.runPromise(
      bus.subscribe(() => Effect.fail(new Error('handler blew up') as never)),
    );

    const error = await runFailure(bus.deliver(anEvent('tx-1')));

    expect(String(error)).toContain('handler blew up');
  });
});
