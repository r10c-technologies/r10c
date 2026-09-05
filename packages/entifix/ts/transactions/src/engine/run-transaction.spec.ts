import {
  type DomainEvent,
  EntifixConnError,
  EntifixLockError,
  EntifixTransactionError,
} from '@r10c/entifix-ts-core';
import { Effect, Exit, HashMap, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

/** The slice every event in this file is published by. */
const TEST_SOURCE = 'test-slice';

import type { TransactionCommand } from '../contracts/command.js';
import type { TransactionEvent } from '../contracts/event.js';
import {
  type OutboxEnqueueResult,
  TransactionOutboxTag,
} from '../contracts/outbox.js';
import {
  CommandTag,
  LockHandlesTag,
  OutcomeTag,
} from '../mixins/transaction-mixins.js';
import { EventBusTag } from '../ports/event-bus.js';
import { EventSourceTag } from '../ports/event-source.js';
import { type LockHandle, LockServiceTag } from '../ports/lock-service.js';
import {
  type TransactionHandler,
  TransactionHandlerTag,
  type TransactionOutcome,
} from '../ports/transaction-handler.js';
import {
  executeUCFactory,
  freeUCFactory,
  lockUCFactory,
  rollbackUCFactory,
  validateUCFactory,
} from '../use-case/facade.uc.js';
import { acceptTransaction, completeTransaction } from './run-transaction.js';

const command: TransactionCommand = {
  transactionId: 'tx-1',
  type: 'create',
  entity: 'product',
  payload: { name: 'Widget' },
};

const outcome: TransactionOutcome = { code: 'product-001', entityId: 'p-1' };

/**
 * A scripted handler plus recording lock service and bus. This package defines
 * the ports `@r10c/entifix-ts-testing-unit` implements, so its doubles cannot be
 * used here without a cycle — these stay local.
 */
const makeWorld = (
  script: {
    validate?: EntifixTransactionError;
    lockKeys?: readonly string[];
    execute?: EntifixTransactionError;
    rollback?: EntifixTransactionError;
    acquireFailsOn?: string;
    releaseFails?: boolean;
    duplicate?: boolean;
    enqueueFails?: boolean;
  } = {},
) => {
  const calls: string[] = [];
  const held: LockHandle[] = [];
  const released: LockHandle[] = [];
  const recorded: DomainEvent<TransactionEvent>[] = [];

  const handler: TransactionHandler = {
    validate: received => {
      calls.push(`validate:${received.transactionId}`);
      return script.validate ? Effect.fail(script.validate) : Effect.void;
    },
    lockKeys: received => {
      calls.push(`lockKeys:${received.entity}`);
      return script.lockKeys ?? ['product:code'];
    },
    execute: () => {
      calls.push('execute');
      return script.execute
        ? Effect.fail(script.execute)
        : Effect.succeed(outcome);
    },
    rollback: (_received, receivedOutcome) => {
      calls.push(`rollback:${String(receivedOutcome)}`);
      return script.rollback ? Effect.fail(script.rollback) : Effect.void;
    },
  };

  const lockService = {
    acquire: (key: string) => {
      calls.push(`acquire:${key}`);
      if (key === script.acquireFailsOn) {
        return Effect.fail(new EntifixLockError(`contended: ${key}`));
      }
      const handle = { key, token: `token-${key}` };
      held.push(handle);
      return Effect.succeed(handle);
    },
    release: (handle: LockHandle) => {
      calls.push(`release:${handle.key}`);
      if (script.releaseFails) {
        return Effect.fail(new EntifixConnError('redis unreachable'));
      }
      released.push(handle);
      return Effect.void;
    },
  };

  // `enqueue` records inside `Effect.sync`, not when it is called: the engine
  // builds some of these effects ahead of running them, and a port that acted
  // on construction would report an ordering no real adapter produces.
  const outbox = {
    enqueue: (event: DomainEvent) =>
      Effect.suspend(
        (): Effect.Effect<OutboxEnqueueResult, EntifixConnError> => {
          const payload = event.data as TransactionEvent;
          calls.push(`enqueue:${payload.step}`);
          if (script.enqueueFails) {
            return Effect.fail(new EntifixConnError('outbox unreachable'));
          }
          if (script.duplicate) {
            return Effect.succeed('duplicate');
          }
          recorded.push(event as DomainEvent<TransactionEvent>);
          return Effect.succeed('enqueued');
        },
      ),
    pending: () => Effect.succeed([]),
    markSent: () => Effect.void,
    // The engine never publishes, so it never records a failed publish either.
    // Dying rather than resolving keeps that true: a call here means the engine
    // grew a relay responsibility it must not have.
    recordFailure: () =>
      Effect.die('the engine must not publish; the relay records failures'),
    // Same reasoning: depth and age are the relay's to sample, and the engine
    // has no business asking how far behind the outbox is.
    stats: () =>
      Effect.die('the engine must not publish; the relay samples the outbox'),
  };

  // The engine must never reach the broker — every event it produces goes to
  // the outbox, and the relay is what publishes. A bus that throws on contact
  // turns a regression into a failing test rather than a silently reintroduced
  // dual write.
  const bus = {
    publish: () => Effect.die('the engine must not publish; use the outbox'),
    subscribe: () => Effect.void,
  };

  const layer = Layer.mergeAll(
    Layer.succeed(TransactionHandlerTag, handler),
    Layer.succeed(LockServiceTag, lockService),
    Layer.succeed(TransactionOutboxTag, outbox),
    Layer.succeed(EventBusTag, bus),
    Layer.succeed(CommandTag, command),
    Layer.succeed(EventSourceTag, TEST_SOURCE),
  );

  return { calls, held, released, recorded, layer };
};

describe('the facade steps', () => {
  it('validate delegates to the handler', () => {
    const world = makeWorld();

    Effect.runSync(validateUCFactory().pipe(Effect.provide(world.layer)));

    expect(world.calls).toEqual(['validate:tx-1']);
  });

  it('validate surfaces the handler’s rejection', () => {
    const failure = new EntifixTransactionError('illegal command');
    const world = makeWorld({ validate: failure });

    expect(
      Effect.runSync(
        Effect.flip(validateUCFactory().pipe(Effect.provide(world.layer))),
      ),
    ).toBe(failure);
  });

  // Keys are acquired in the order the handler declares them, which is what
  // keeps two concurrent commands from deadlocking against each other.
  it('lock acquires every declared key in order', () => {
    const world = makeWorld({ lockKeys: ['a', 'b'] });

    const handles = Effect.runSync(
      lockUCFactory().pipe(Effect.provide(world.layer)),
    );

    expect(handles.map(handle => handle.key)).toEqual(['a', 'b']);
    expect(world.calls).toEqual(['lockKeys:product', 'acquire:a', 'acquire:b']);
  });

  it('lock stops at the first contended key', () => {
    const world = makeWorld({ lockKeys: ['a', 'b', 'c'], acquireFailsOn: 'b' });

    const error = Effect.runSync(
      Effect.flip(lockUCFactory().pipe(Effect.provide(world.layer))),
    );

    expect(error).toBeInstanceOf(EntifixLockError);
    expect(world.calls).not.toContain('acquire:c');
  });

  it('execute returns the handler’s outcome', () => {
    const world = makeWorld();

    expect(
      Effect.runSync(executeUCFactory().pipe(Effect.provide(world.layer))),
    ).toBe(outcome);
  });

  it('rollback passes the outcome from context to the handler', () => {
    const world = makeWorld();

    Effect.runSync(
      rollbackUCFactory().pipe(
        Effect.provide(world.layer),
        Effect.provideService(OutcomeTag, outcome),
      ),
    );

    expect(world.calls).toContain(`rollback:${String(outcome)}`);
  });

  it('free releases every handle', () => {
    const world = makeWorld();
    const handles = [
      { key: 'a', token: 't-a' },
      { key: 'b', token: 't-b' },
    ];

    Effect.runSync(
      freeUCFactory().pipe(
        Effect.provide(world.layer),
        Effect.provideService(LockHandlesTag, handles),
      ),
    );

    expect(world.released).toEqual(handles);
  });
});

describe('acceptTransaction', () => {
  // This phase runs before the service answers 202, so its ordering is what a
  // client observes. Claiming *before* locking is what makes a replay cheap: a
  // repeated command is recognised without ever queueing behind its original.
  it('validates, claims, then locks', () => {
    const world = makeWorld();

    const accepted = Effect.runSync(
      acceptTransaction().pipe(Effect.provide(world.layer)),
    );

    expect(world.calls).toEqual([
      'validate:tx-1',
      'enqueue:accepted',
      'lockKeys:product',
      'acquire:product:code',
    ]);
    expect(accepted.status).toBe('accepted');
    expect(
      accepted.status === 'accepted'
        ? accepted.handles.map(handle => handle.key)
        : [],
    ).toEqual(['product:code']);
  });

  it('records an accepted event in the PENDING state', () => {
    const world = makeWorld();

    Effect.runSync(acceptTransaction().pipe(Effect.provide(world.layer)));

    expect(world.recorded).toHaveLength(1);
    // The message is addressed and signed as well as carried: `name` is what the
    // broker routes on, `id` is what a consumer deduplicates on, and `source`
    // says which slice published it.
    expect(world.recorded[0]).toMatchObject({
      name: 'transaction.accepted',
      id: 'tx-1:accepted',
      source: TEST_SOURCE,
      correlationId: 'tx-1',
      data: {
        transactionId: 'tx-1',
        entity: 'product',
        state: 'PENDING',
        step: 'accepted',
      },
    });
  });

  // The idempotency key at work: the outbox's uniqueness on transactionId+step
  // rejects the claim, and the engine stops there. Locking or forking work for
  // a replay is what would execute the same command twice.
  it('reports a duplicate and takes no lock when the claim is already held', () => {
    const world = makeWorld({ duplicate: true });

    const accepted = Effect.runSync(
      acceptTransaction().pipe(Effect.provide(world.layer)),
    );

    expect(accepted.status).toBe('duplicate');
    expect(world.calls).toEqual(['validate:tx-1', 'enqueue:accepted']);
    expect(world.held).toEqual([]);
  });

  it('takes no lock and records nothing when validation rejects', () => {
    const world = makeWorld({
      validate: new EntifixTransactionError('illegal'),
    });

    const exit = Effect.runSyncExit(
      acceptTransaction().pipe(Effect.provide(world.layer)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(world.calls).toEqual(['validate:tx-1']);
    expect(world.recorded).toEqual([]);
  });

  // A claim that cannot be written must fail the request rather than proceed:
  // executing without it would leave a write nothing can announce or replay.
  it('fails without locking when the claim cannot be recorded', () => {
    const world = makeWorld({ enqueueFails: true });

    const error = Effect.runSync(
      Effect.flip(acceptTransaction().pipe(Effect.provide(world.layer))),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
    expect(world.held).toEqual([]);
  });

  it('records nothing extra when a lock is contended', () => {
    const world = makeWorld({ acquireFailsOn: 'product:code' });

    const error = Effect.runSync(
      Effect.flip(acceptTransaction().pipe(Effect.provide(world.layer))),
    );

    expect(error).toBeInstanceOf(EntifixLockError);
    expect(world.recorded.map(event => event.data.step)).toEqual(['accepted']);
  });
});

describe('completeTransaction', () => {
  const handles: readonly LockHandle[] = [
    { key: 'product:code', token: 'token-1' },
  ];

  // The invariant the outbox design rests on: `execute` wrote the completed
  // entry inside its own storage transaction, so the engine recording one here
  // as well would announce a state change that may still have rolled back.
  it('executes and frees, recording nothing on success', () => {
    const world = makeWorld();

    Effect.runSync(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(world.calls).toEqual(['execute', 'release:product:code']);
    expect(world.recorded).toEqual([]);
  });

  it('rolls back, records failure, then frees the locks when execute fails', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
    });

    Effect.runSync(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(world.calls).toEqual([
      'execute',
      'rollback:undefined',
      'enqueue:failed',
      'release:product:code',
    ]);
    expect(world.recorded[0]).toMatchObject({
      name: 'transaction.failed',
      id: 'tx-1:failed',
      source: TEST_SOURCE,
      data: { state: 'FAILED', step: 'failed', error: 'write failed' },
    });
  });

  // `rollback` runs without an outcome because `execute` never produced one —
  // which is exactly why the port documents it as idempotent.
  it('rolls back with no outcome', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
    });

    Effect.runSync(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(world.calls).toContain('rollback:undefined');
  });

  // A failing rollback must not swallow the failure record: the client is
  // polling for a terminal state and would otherwise wait forever.
  it('still records failure and frees when rollback itself fails', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
      rollback: new EntifixTransactionError('rollback failed'),
    });

    const exit = Effect.runSyncExit(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(world.recorded[0]).toMatchObject({
      data: { step: 'failed', error: 'write failed' },
    });
    expect(world.calls).toContain('release:product:code');
  });

  // The recorded event's `error` is `execute`'s, so without this log the
  // compensation's own failure reaches nothing at all and an operator reading
  // `FAILED` concludes the write was undone when it was not (ADR 0039).
  it('logs the compensation failure it has to discard', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
      rollback: new EntifixTransactionError('rollback failed'),
    });
    const logs: Array<{
      message: string;
      annotations: Record<string, unknown>;
    }> = [];

    Effect.runSync(
      completeTransaction(handles).pipe(
        Effect.provide(world.layer),
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            Logger.make(({ message, annotations }) => {
              logs.push({
                message: String(message),
                annotations: Object.fromEntries(HashMap.toEntries(annotations)),
              });
            }),
          ),
        ),
      ),
    );

    expect(logs).toEqual([
      {
        message: 'transaction rollback failed',
        annotations: {
          transactionId: 'tx-1',
          entity: 'product',
          executeError: expect.stringContaining('write failed'),
          rollbackError: expect.stringContaining('rollback failed'),
        },
      },
    ]);
  });

  // A rollback that succeeds says nothing: the failure record already tells the
  // client what happened, and a log per ordinary failed transaction is noise
  // that makes the stranded ones above harder to find.
  it('logs nothing when the compensation succeeds', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
    });
    const logs: string[] = [];

    Effect.runSync(
      completeTransaction(handles).pipe(
        Effect.provide(world.layer),
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            Logger.make(({ message }) => {
              logs.push(String(message));
            }),
          ),
        ),
      ),
    );

    expect(logs).toEqual([]);
  });

  // The transaction already failed; an outbox that cannot take the record must
  // not become an unhandled defect in a forked daemon. The sweep is what
  // notices such a transaction.
  it('survives an outbox that cannot record the failure', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
      enqueueFails: true,
    });

    const exit = Effect.runSyncExit(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(world.calls).toContain('release:product:code');
  });

  // Freeing is best-effort: a dead Redis must not turn a completed write into a
  // reported failure. The locks lapse on their own TTL.
  it('succeeds even when releasing the locks fails', () => {
    const world = makeWorld({ releaseFails: true });

    const exit = Effect.runSyncExit(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it('frees every held lock', () => {
    const world = makeWorld();
    const many: readonly LockHandle[] = [
      { key: 'a', token: 't-a' },
      { key: 'b', token: 't-b' },
    ];

    Effect.runSync(completeTransaction(many).pipe(Effect.provide(world.layer)));

    expect(world.released.map(handle => handle.key)).toEqual(['a', 'b']);
  });
});

describe('context tags', () => {
  it('carry distinct identifiers', () => {
    const identifiers = [
      CommandTag,
      LockHandlesTag,
      OutcomeTag,
      EventBusTag,
      LockServiceTag,
      TransactionHandlerTag,
      TransactionOutboxTag,
    ].map(tag => tag.key);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });
});
