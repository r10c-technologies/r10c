import {
  EntifixConnError,
  EntifixLockError,
  EntifixTransactionError,
} from '@r10c/entifix-ts-core';
import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import type { TransactionCommand } from '../contracts/command.js';
import type { TransactionEvent } from '../contracts/event.js';
import { CommandTag, LockHandlesTag, OutcomeTag } from '../mixins/transaction-mixins.js';
import { EventBusTag } from '../ports/event-bus.js';
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
  } = {},
) => {
  const calls: string[] = [];
  const held: LockHandle[] = [];
  const released: LockHandle[] = [];
  const published: TransactionEvent[] = [];

  const handler: TransactionHandler = {
    validate: (received) => {
      calls.push(`validate:${received.transactionId}`);
      return script.validate ? Effect.fail(script.validate) : Effect.void;
    },
    lockKeys: (received) => {
      calls.push(`lockKeys:${received.entity}`);
      return script.lockKeys ?? ['product:code'];
    },
    execute: () => {
      calls.push('execute');
      return script.execute ? Effect.fail(script.execute) : Effect.succeed(outcome);
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

  // `publish` records inside `Effect.sync`, not when it is called: the engine
  // builds some of these effects ahead of running them, and a port that acted
  // on construction would report an ordering no real adapter produces.
  const bus = {
    publish: (event: TransactionEvent) =>
      Effect.sync(() => {
        calls.push(`publish:${event.step}`);
        published.push(event);
      }),
    subscribe: () => Effect.void,
  };

  const layer = Layer.mergeAll(
    Layer.succeed(TransactionHandlerTag, handler),
    Layer.succeed(LockServiceTag, lockService),
    Layer.succeed(EventBusTag, bus),
    Layer.succeed(CommandTag, command),
  );

  return { calls, held, released, published, layer };
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
      Effect.runSync(Effect.flip(validateUCFactory().pipe(Effect.provide(world.layer)))),
    ).toBe(failure);
  });

  // Keys are acquired in the order the handler declares them, which is what
  // keeps two concurrent commands from deadlocking against each other.
  it('lock acquires every declared key in order', () => {
    const world = makeWorld({ lockKeys: ['a', 'b'] });

    const handles = Effect.runSync(lockUCFactory().pipe(Effect.provide(world.layer)));

    expect(handles.map((handle) => handle.key)).toEqual(['a', 'b']);
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

    expect(Effect.runSync(executeUCFactory().pipe(Effect.provide(world.layer)))).toBe(
      outcome,
    );
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
  // client observes: nothing is announced until the locks are actually held.
  it('validates, locks, then announces acceptance', () => {
    const world = makeWorld();

    const handles = Effect.runSync(acceptTransaction().pipe(Effect.provide(world.layer)));

    expect(world.calls).toEqual([
      'validate:tx-1',
      'lockKeys:product',
      'acquire:product:code',
      'publish:accepted',
    ]);
    expect(handles.map((handle) => handle.key)).toEqual(['product:code']);
  });

  it('publishes an accepted event in the PENDING state', () => {
    const world = makeWorld();

    Effect.runSync(acceptTransaction().pipe(Effect.provide(world.layer)));

    expect(world.published).toHaveLength(1);
    expect(world.published[0]).toMatchObject({
      transactionId: 'tx-1',
      entity: 'product',
      state: 'PENDING',
      step: 'accepted',
    });
  });

  it('takes no lock and announces nothing when validation rejects', () => {
    const world = makeWorld({ validate: new EntifixTransactionError('illegal') });

    const exit = Effect.runSyncExit(acceptTransaction().pipe(Effect.provide(world.layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(world.calls).toEqual(['validate:tx-1']);
    expect(world.published).toEqual([]);
  });

  it('announces nothing when a lock is contended', () => {
    const world = makeWorld({ acquireFailsOn: 'product:code' });

    const error = Effect.runSync(
      Effect.flip(acceptTransaction().pipe(Effect.provide(world.layer))),
    );

    expect(error).toBeInstanceOf(EntifixLockError);
    expect(world.published).toEqual([]);
  });
});

describe('completeTransaction', () => {
  const handles: readonly LockHandle[] = [{ key: 'product:code', token: 'token-1' }];

  it('executes, announces completion, then frees the locks', () => {
    const world = makeWorld();

    Effect.runSync(completeTransaction(handles).pipe(Effect.provide(world.layer)));

    expect(world.calls).toEqual([
      'execute',
      'publish:completed',
      'release:product:code',
    ]);
    expect(world.published[0]).toMatchObject({
      state: 'COMPLETED',
      step: 'completed',
      code: 'product-001',
      entityId: 'p-1',
    });
  });

  it('rolls back, announces failure, then frees the locks when execute fails', () => {
    const world = makeWorld({ execute: new EntifixTransactionError('write failed') });

    Effect.runSync(completeTransaction(handles).pipe(Effect.provide(world.layer)));

    expect(world.calls).toEqual([
      'execute',
      'rollback:undefined',
      'publish:failed',
      'release:product:code',
    ]);
    expect(world.published[0]).toMatchObject({
      state: 'FAILED',
      step: 'failed',
      error: 'write failed',
    });
  });

  // `rollback` runs without an outcome because `execute` never produced one —
  // which is exactly why the port documents it as idempotent.
  it('rolls back with no outcome', () => {
    const world = makeWorld({ execute: new EntifixTransactionError('write failed') });

    Effect.runSync(completeTransaction(handles).pipe(Effect.provide(world.layer)));

    expect(world.calls).toContain('rollback:undefined');
  });

  // A failing rollback must not swallow the failure announcement: the client is
  // polling for a terminal state and would otherwise wait forever.
  it('still announces failure and frees when rollback itself fails', () => {
    const world = makeWorld({
      execute: new EntifixTransactionError('write failed'),
      rollback: new EntifixTransactionError('rollback failed'),
    });

    const exit = Effect.runSyncExit(
      completeTransaction(handles).pipe(Effect.provide(world.layer)),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(world.published[0]).toMatchObject({ step: 'failed', error: 'write failed' });
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
    expect(world.published[0]).toMatchObject({ step: 'completed' });
  });

  it('frees every held lock', () => {
    const world = makeWorld();
    const many: readonly LockHandle[] = [
      { key: 'a', token: 't-a' },
      { key: 'b', token: 't-b' },
    ];

    Effect.runSync(completeTransaction(many).pipe(Effect.provide(world.layer)));

    expect(world.released.map((handle) => handle.key)).toEqual(['a', 'b']);
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
    ].map((tag) => tag.key);

    expect(new Set(identifiers).size).toBe(identifiers.length);
  });
});
