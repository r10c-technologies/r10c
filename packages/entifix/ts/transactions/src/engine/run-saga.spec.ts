import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defineSaga,
  type SagaStepOutcome,
} from '../contracts/saga-definition.js';
import {
  type SagaDispatch,
  SagaDispatcherTag,
  type SagaResponse,
} from '../ports/saga-dispatcher.js';
import {
  type SagaInstance,
  type SagaState,
  SagaStoreTag,
} from '../ports/saga-store.js';
import type { SagaInputs } from './run-saga.js';
import { runSaga } from './run-saga.js';

/**
 * A recording dispatcher plus an in-memory store.
 *
 * This package *defines* the ports `@r10c/entifix-ts-testing-unit` implements,
 * so its doubles cannot be used here without a cycle — these stay local, the
 * same choice `run-transaction.spec.ts` made.
 */
const makeWorld = (
  respond: (dispatch: SagaDispatch, call: number) => SagaResponse | 'throw',
) => {
  const dispatched: SagaDispatch[] = [];
  const transitions: Array<{ state: SagaState; error?: string }> = [];
  const outcomes: SagaStepOutcome[] = [];
  const begun: number[] = [];
  let started: Omit<SagaInstance, 'updatedAt'> | undefined;

  const dispatcher = Layer.succeed(SagaDispatcherTag, {
    dispatch: (dispatch: SagaDispatch) =>
      Effect.suspend(() => {
        dispatched.push(dispatch);
        const answer = respond(dispatch, dispatched.length - 1);
        return answer === 'throw'
          ? Effect.fail(
              new EntifixConnError('participant unreachable', undefined, {
                participant: dispatch.participant,
              }),
            )
          : Effect.succeed(answer);
      }),
  });

  const store = Layer.succeed(SagaStoreTag, {
    start: (instance: Omit<SagaInstance, 'updatedAt'>) =>
      Effect.sync(() => {
        started = instance;
      }),
    beginStep: (_sagaId: string, stepIndex: number) =>
      Effect.sync(() => {
        begun.push(stepIndex);
      }),
    recordOutcome: (_sagaId: string, outcome: SagaStepOutcome) =>
      Effect.sync(() => {
        outcomes.push(outcome);
      }),
    settle: (_sagaId: string, state: SagaState, error?: string) =>
      Effect.sync(() => {
        transitions.push({ state, error });
      }),
    get: () => Effect.succeed(undefined),
    findStale: () => Effect.succeed([]),
  });

  return {
    layer: Layer.merge(dispatcher, store),
    dispatched,
    transitions,
    outcomes,
    begun,
    startedWith: () => started,
  };
};

const ok = (body: unknown = {}): SagaResponse => ({
  ok: true,
  status: 201,
  body,
});
const refused: SagaResponse = { ok: false, status: 409, body: {} };

/** Checkout's real shape: a fan-out reserve, then the order write. */
const checkout = defineSaga({
  name: 'checkout',
  permission: 'order-management:product-order:write',
  steps: [
    {
      id: 'reserve',
      participant: 'stock-service',
      command: { method: 'POST', path: '/api/reservation' },
      compensation: {
        method: 'DELETE',
        path: '/api/reservation/{outcome.data.id}',
      },
      kind: 'compensatable',
      fanOut: true,
    },
    {
      id: 'write-order',
      participant: 'order-service',
      command: { method: 'POST', path: '/api/product-order' },
      compensation: {
        method: 'DELETE',
        path: '/api/product-order/{outcome.data.id}',
      },
      kind: 'compensatable',
    },
  ],
});

const twoLines: SagaInputs = {
  reserve: [
    { body: { offeringId: 'o-1' }, organizationId: 'vendor-a' },
    { body: { offeringId: 'o-2' }, organizationId: 'vendor-b' },
  ],
  'write-order': [{ body: { total: 2 } }],
};

const run = (
  world: ReturnType<typeof makeWorld>,
  inputs: SagaInputs = twoLines,
) =>
  Effect.runPromise(
    runSaga({ sagaId: 'saga-1', definition: checkout, inputs }).pipe(
      Effect.provide(world.layer),
      Effect.provide(Logger.remove(Logger.defaultLogger)),
    ),
  );

describe('runSaga — the happy path', () => {
  it('dispatches every call and completes', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));
    const result = await run(world);

    expect(result.state).toBe('COMPLETED');
    expect(world.dispatched.map(d => d.call.path)).toEqual([
      '/api/reservation',
      '/api/reservation',
      '/api/product-order',
    ]);
    expect(world.transitions).toEqual([
      { state: 'COMPLETED', error: undefined },
    ]);
  });

  it('records the instance as RUNNING before anything is dispatched', async () => {
    const world = makeWorld(() => ok({ data: { id: 'r' } }));
    await run(world);

    expect(world.startedWith()).toMatchObject({
      sagaId: 'saga-1',
      definition: 'checkout',
      state: 'RUNNING',
      stepIndex: 0,
      outcomes: [],
    });
  });

  /**
   * ⚠️ ADR 0028's rule, extended from events to commands: a coordinator that
   * marks a step in flight only *after* calling has the dual write that record
   * exists to close.
   */
  it('persists each step transition before dispatching it', async () => {
    const world = makeWorld(() => ok({ data: { id: 'r' } }));
    await run(world);

    expect(world.begun).toEqual([0, 1]);
  });

  it('gives a fan-out call its own command id and organization', async () => {
    const world = makeWorld(() => ok({ data: { id: 'r' } }));
    await run(world);

    expect(world.dispatched.slice(0, 2).map(d => d.commandId)).toEqual([
      'saga-1:reserve:0',
      'saga-1:reserve:1',
    ]);
    expect(world.dispatched.slice(0, 2).map(d => d.organizationId)).toEqual([
      'vendor-a',
      'vendor-b',
    ]);
    // Not a fan-out step, so no index — and no organization, because
    // order-service is platform plane.
    expect(world.dispatched[2]?.commandId).toBe('saga-1:write-order');
    expect(world.dispatched[2]?.organizationId).toBeUndefined();
  });

  it('makes exactly one call for a step given no input at all', async () => {
    const world = makeWorld(() => ok({ data: { id: 'r' } }));
    await run(world, { reserve: [{ body: { offeringId: 'o-1' } }] });

    expect(world.dispatched).toHaveLength(2);
    expect(world.dispatched[1]?.body).toBeUndefined();
  });

  it('sends no body on a DELETE', async () => {
    const world = makeWorld(() => ok({ data: { id: 'r-9' } }));
    await run(world, { reserve: [], 'write-order': [{ body: { total: 0 } }] });

    // The fan-out step had nothing to do; the order write carries its body.
    expect(world.dispatched).toHaveLength(1);
    expect(world.dispatched[0]?.body).toEqual({ total: 0 });
  });
});

describe('runSaga — compensation', () => {
  /**
   * ⚠️ The case ADR 0052 built `SagaStepOutcome.calls` for. Two holds taken,
   * the order write refused: **both** holds come back, each addressed by its
   * own recorded id.
   */
  it('releases every hold when a later step is refused', async () => {
    const world = makeWorld((d, call) =>
      d.participant === 'order-service' && d.call.method === 'POST'
        ? refused
        : ok({ data: { id: `r-${call}` } }),
    );

    const result = await run(world);

    expect(result.state).toBe('COMPENSATED');
    const compensations = world.dispatched.filter(
      d => d.call.method === 'DELETE',
    );
    expect(compensations.map(d => d.call.path)).toEqual([
      '/api/reservation/r-1',
      '/api/reservation/r-0',
    ]);
  });

  /**
   * ⚠️ The partial fan-out — the failure a step-level compensation gets wrong.
   * Line 1 is held, line 2 is refused: exactly **one** release, and it names
   * the hold that was actually taken.
   */
  it('compensates only the fan-out calls that succeeded', async () => {
    const world = makeWorld((d, call) =>
      d.call.method === 'POST' && call === 1
        ? refused
        : ok({ data: { id: `r-${call}` } }),
    );

    const result = await run(world);

    expect(result.state).toBe('COMPENSATED');
    const compensations = world.dispatched.filter(
      d => d.call.method === 'DELETE',
    );
    expect(compensations).toHaveLength(1);
    expect(compensations[0]?.call.path).toBe('/api/reservation/r-0');
  });

  it('never dispatches a step after the one that was refused', async () => {
    const world = makeWorld(d => (d.call.method === 'POST' ? refused : ok()));
    await run(world);

    expect(
      world.dispatched.some(d => d.call.path === '/api/product-order'),
    ).toBe(false);
  });

  it('moves through COMPENSATING before settling', async () => {
    const world = makeWorld((d, call) =>
      d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } }),
    );
    await run(world);

    expect(world.transitions.map(t => t.state)).toEqual([
      'COMPENSATING',
      'COMPENSATED',
    ]);
    expect(world.transitions[0]?.error).toMatch(/refused with 409/);
  });

  it('records an outcome for the refused step as well as the successful ones', async () => {
    const world = makeWorld((d, call) =>
      d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } }),
    );
    await run(world);

    expect(world.outcomes.map(o => o.stepId)).toEqual([
      'reserve',
      'write-order',
    ]);
    expect(world.outcomes[1]?.calls).toEqual([]);
  });
});

describe('runSaga — a stranded saga is surfaced, never swallowed', () => {
  /**
   * ⚠️ ADR 0039 calls this the failure class nobody plans for, and it is the
   * state that leaves a reservation held and — once payment lands — a customer
   * charged. `COMPENSATED` and `STRANDED` must not collapse into one `FAILED`.
   */
  it('settles STRANDED when a compensation is refused', async () => {
    const world = makeWorld((d, call) => {
      if (d.call.method === 'DELETE') return refused;
      return d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } });
    });

    const result = await run(world);

    expect(result.state).toBe('STRANDED');
    expect(world.transitions.at(-1)?.state).toBe('STRANDED');
  });

  it('settles STRANDED when a compensation cannot reach its participant', async () => {
    const world = makeWorld((d, call) => {
      if (d.call.method === 'DELETE') return 'throw';
      return d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } });
    });

    expect((await run(world)).state).toBe('STRANDED');
  });

  /**
   * A compensation template that no longer matches its participant's response
   * shape throws a defect. It must strand the saga rather than crash the walk
   * and leave every remaining hold in place.
   */
  it('settles STRANDED when a compensation template cannot resolve', async () => {
    const world = makeWorld((d, call) =>
      d.participant === 'order-service'
        ? refused
        : // No `data.id`, so the DELETE template has nothing to interpolate.
          ok({ nothing: `r-${call}` }),
    );

    expect((await run(world)).state).toBe('STRANDED');
  });

  it('logs the failure with the saga id', async () => {
    const logged: string[] = [];
    const world = makeWorld((d, call) => {
      if (d.call.method === 'DELETE') return refused;
      return d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } });
    });

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-1',
        definition: checkout,
        inputs: twoLines,
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(
          Logger.replace(
            Logger.defaultLogger,
            Logger.make(({ message, annotations }) => {
              logged.push(
                `${String(message)} ${String(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (annotations as any)?.pipe?.name ?? '',
                )}`,
              );
            }),
          ),
        ),
      ),
    );

    expect(logged.some(line => line.includes('saga compensation failed'))).toBe(
      true,
    );
  });
});

describe('runSaga — a step with no compensation', () => {
  /**
   * A `retriable` step declares none by construction (`defineSaga` refuses one),
   * so unwinding past it must be a no-op rather than a crash.
   */
  it('skips a step that declares no compensation', async () => {
    const definition = defineSaga({
      name: 'with-pivot',
      permission: 'payment-management:payment:write',
      steps: [
        {
          id: 'capture',
          participant: 'payment-service',
          command: { method: 'POST', path: '/api/payment' },
          kind: 'pivot',
        },
        {
          id: 'notify',
          participant: 'notification-service',
          command: { method: 'POST', path: '/api/notification' },
          kind: 'retriable',
        },
      ],
    });

    const world = makeWorld(d =>
      d.participant === 'notification-service' ? refused : ok(),
    );

    const result = await Effect.runPromise(
      runSaga({ sagaId: 'saga-2', definition, inputs: {} }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    // Nothing was reversible, so nothing was reversed — and the saga is
    // COMPENSATED rather than STRANDED, because no compensation failed.
    expect(result.state).toBe('COMPENSATED');
    expect(world.dispatched.filter(d => d.call.method === 'DELETE')).toEqual(
      [],
    );
  });
});

describe('runSaga — a participant that is down', () => {
  /**
   * ⚠️ Not the same as a refusal. A transport failure fails the effect so the
   * dispatch is retried; a `409` fails the saga forward into compensation.
   * Collapsing the two either retries an out-of-stock line forever or
   * permanently fails a checkout because a pod was restarting.
   */
  it('fails the effect rather than compensating', async () => {
    const world = makeWorld(() => 'throw');

    await expect(run(world)).rejects.toThrow(/participant unreachable/);
    expect(world.transitions).toEqual([]);
  });
});
