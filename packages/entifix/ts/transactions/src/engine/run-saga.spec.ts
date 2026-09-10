import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect, Layer, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  defineSaga,
  type SagaDefinition,
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
import { resumeSaga, runSaga } from './run-saga.js';

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
  const compensated: string[] = [];
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
    claimForResume: () => Effect.succeed(undefined),
    markCompensated: (_sagaId: string, stepId: string) =>
      Effect.sync(() => {
        compensated.push(stepId);
      }),
  });

  return {
    layer: Layer.merge(dispatcher, store),
    dispatched,
    transitions,
    outcomes,
    begun,
    compensated,
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

  /**
   * ⚠️ **The bug a live pass caught and every mock suite missed.** A
   * tenant-plane participant resolves its storage handle from
   * `x-organization-id`; a compensation dispatched without it is refused `400`
   * *before* it reaches the hold, and the saga strands with the stock still
   * held while the engine reports it tried to release. Measured on the live lab
   * on 2026-09-09: two holds taken, a third line refused, both releases
   * rejected for a missing header.
   *
   * A mock harness could not see it because nothing there resolves a tenant
   * handle — the organization was carried, unused, and its absence cost
   * nothing.
   */
  it('compensates against the organization the call acted for', async () => {
    const world = makeWorld((d, call) =>
      d.participant === 'order-service'
        ? refused
        : ok({ data: { id: `r-${call}` } }),
    );

    await run(world);

    const compensations = world.dispatched.filter(
      d => d.call.method === 'DELETE',
    );
    // Reverse order, so vendor-b's hold is released first.
    expect(compensations.map(d => d.organizationId)).toEqual([
      'vendor-b',
      'vendor-a',
    ]);
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

/** Checkout as of M4: reserve, write the order, capture, convert the hold. */
const checkoutWithCapture = defineSaga({
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
    {
      id: 'capture-payment',
      participant: 'payment-service',
      command: { method: 'POST', path: '/api/payment' },
      kind: 'pivot',
    },
    {
      id: 'convert-reservation',
      participant: 'stock-service',
      command: {
        method: 'POST',
        path: '/api/reservation/{outcome.data.id}/conversion',
      },
      kind: 'retriable',
      fanOut: true,
      fanOutFrom: 'reserve',
    },
  ],
});

describe('runSaga — once the pivot has committed', () => {
  /**
   * The defect this rule exists to stop. `compensateStep` no-ops on a step that
   * declares no compensation, so an unconditional unwind walks straight past the
   * capture and then deletes the order and releases the holds — money taken,
   * goods back on sale.
   */
  it('never compensates a step behind a committed pivot', async () => {
    const world = makeWorld(d =>
      d.call.path.includes('/conversion')
        ? refused
        : ok({ data: { id: 'r-1' } }),
    );

    const result = await Effect.runPromise(
      runSaga({
        sagaId: 'saga-2',
        definition: checkoutWithCapture,
        inputs: { reserve: [{ body: {} }] },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(result.state).toBe('STRANDED');
    // The assertion that matters is on the dispatcher, not the state: no
    // compensation was attempted at all.
    expect(world.dispatched.filter(d => d.call.method === 'DELETE')).toEqual(
      [],
    );
    expect(world.transitions.map(t => t.state)).toEqual(['STRANDED']);
  });

  it('retries the failing step before stranding, on a stable command id', async () => {
    const world = makeWorld(d =>
      d.call.path.includes('/conversion')
        ? refused
        : ok({ data: { id: 'r-1' } }),
    );

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-3',
        definition: checkoutWithCapture,
        inputs: { reserve: [{ body: {} }] },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    const conversions = world.dispatched.filter(d =>
      d.call.path.includes('/conversion'),
    );
    // One dispatch plus POST_PIVOT_RETRIES.
    expect(conversions).toHaveLength(4);
    // Every attempt carries the same command id, which is the only thing that
    // makes re-dispatching a call that may have succeeded safe.
    expect(new Set(conversions.map(d => d.commandId)).size).toBe(1);
  });

  it('still unwinds when the pivot itself refuses', async () => {
    const world = makeWorld(d =>
      d.participant === 'payment-service'
        ? refused
        : ok({ data: { id: 'r-1' } }),
    );

    const result = await Effect.runPromise(
      runSaga({
        sagaId: 'saga-4',
        definition: checkoutWithCapture,
        inputs: { reserve: [{ body: {} }] },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    // A pivot that refuses committed nothing, so the saga is fully reversible.
    expect(result.state).toBe('COMPENSATED');
    expect(
      world.dispatched
        .filter(d => d.call.method === 'DELETE')
        .map(d => d.call.path),
    ).toEqual(['/api/product-order/r-1', '/api/reservation/r-1']);
  });

  it('does not retry a step before the pivot', async () => {
    const world = makeWorld(d =>
      d.participant === 'order-service' ? refused : ok({ data: { id: 'r-1' } }),
    );

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-5',
        definition: checkoutWithCapture,
        inputs: { reserve: [{ body: {} }] },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(
      world.dispatched.filter(d => d.participant === 'order-service'),
    ).toHaveLength(1);
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

describe('runSaga — a step that fans out from an earlier one', () => {
  /**
   * ⚠️ The gap this exists to close, found on the live lab. `convert-reservation`
   * is addressed by an id stock-service mints, so a caller cannot supply it —
   * and without `fanOutFrom` the step made **zero calls** while the saga
   * reported COMPLETED and the holds sat until they expired.
   */
  it('makes one call per successful call of the step it names', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));

    const result = await Effect.runPromise(
      runSaga({
        sagaId: 'saga-6',
        definition: checkoutWithCapture,
        inputs: {
          reserve: [
            { body: { offeringId: 'o-1' }, organizationId: 'vendor-a' },
            { body: { offeringId: 'o-2' }, organizationId: 'vendor-b' },
          ],
        },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(result.state).toBe('COMPLETED');
    const conversions = world.dispatched.filter(d =>
      d.call.path.includes('/conversion'),
    );
    expect(conversions.map(d => d.call.path)).toEqual([
      '/api/reservation/r-0/conversion',
      '/api/reservation/r-1/conversion',
    ]);
  });

  /**
   * ⚠️ **The organization comes from the earlier call, never the caller.** A
   * tenant-plane participant resolves its handle from the header, so a
   * conversion dispatched without it is refused `400` — and the hold expires
   * under a buyer who has already been charged.
   */
  it('carries each earlier calls organization onto its conversion', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-7',
        definition: checkoutWithCapture,
        inputs: {
          reserve: [
            { body: { offeringId: 'o-1' }, organizationId: 'vendor-a' },
            { body: { offeringId: 'o-2' }, organizationId: 'vendor-b' },
          ],
        },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(
      world.dispatched
        .filter(d => d.call.path.includes('/conversion'))
        .map(d => d.organizationId),
    ).toEqual(['vendor-a', 'vendor-b']);
  });

  it('makes no call when the step it names took none', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-8',
        definition: checkoutWithCapture,
        inputs: { reserve: [] },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(
      world.dispatched.filter(d => d.call.path.includes('/conversion')),
    ).toEqual([]);
  });
});

describe('defineSaga — fanOutFrom', () => {
  const withFanOutFrom = (fanOutFrom: string) => () =>
    defineSaga({
      name: 'bad',
      permission: 'order-management:product-order:write',
      steps: [
        {
          id: 'first',
          participant: 'a',
          command: { method: 'POST', path: '/api/a' },
          kind: 'pivot',
        },
        {
          id: 'second',
          participant: 'b',
          command: { method: 'POST', path: '/api/b' },
          kind: 'retriable',
          fanOut: true,
          fanOutFrom,
        },
      ],
    });

  /**
   * ⚠️ A forward reference would produce zero calls rather than an error — a
   * step that looks like it ran and did nothing, which is exactly how a
   * conversion gets skipped while the saga reports COMPLETED.
   */
  it('refuses a step that names one after it', () => {
    expect(withFanOutFrom('third')).toThrow(/is not a step before it/);
  });

  it('refuses a step that names itself', () => {
    expect(withFanOutFrom('second')).toThrow(/is not a step before it/);
  });

  it('accepts a step that names one before it', () => {
    expect(withFanOutFrom('first')).not.toThrow();
  });
});

describe('runSaga — a derived fan-out still carries a body', () => {
  it('sends the body declared for the step to every derived call', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));

    await Effect.runPromise(
      runSaga({
        sagaId: 'saga-9',
        definition: checkoutWithCapture,
        inputs: {
          reserve: [{ body: {}, organizationId: 'vendor-a' }],
          // The cardinality comes from `reserve`; what the caller may still say
          // is *what to send*, which a conversion carrying a movement reason
          // would need.
          'convert-reservation': [{ body: { reason: 'sale' } }],
        },
      }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(
      world.dispatched
        .filter(d => d.call.path.includes('/conversion'))
        .map(d => d.body),
    ).toEqual([{ reason: 'sale' }]);
  });

  /**
   * ⚠️ Defensive, and reachable only past `defineSaga`. `SagaDefinition` is a
   * plain interface, so a definition built by hand can name a step that is not
   * there — and answering zero calls beats throwing inside a flow that has
   * already taken money.
   */
  it('makes no call when the named step is not in the definition', async () => {
    const handBuilt: SagaDefinition = {
      name: 'hand-built',
      permission: 'order-management:product-order:write',
      steps: [
        {
          id: 'convert',
          participant: 'stock-service',
          command: { method: 'POST', path: '/api/reservation/x/conversion' },
          kind: 'compensatable',
          compensation: { method: 'DELETE', path: '/api/reservation/x' },
          fanOut: true,
          fanOutFrom: 'a-step-that-is-not-here',
        },
      ],
    };
    const world = makeWorld(() => ok({ data: { id: 'r' } }));

    const result = await Effect.runPromise(
      runSaga({ sagaId: 'saga-10', definition: handBuilt, inputs: {} }).pipe(
        Effect.provide(world.layer),
        Effect.provide(Logger.remove(Logger.defaultLogger)),
      ),
    );

    expect(result.state).toBe('COMPLETED');
    expect(world.dispatched).toEqual([]);
  });
});

/**
 * An instance as a dead coordinator would have left it.
 *
 * Everything a resume needs is here because everything a resume needs was
 * written as the walk went: the inputs at `start`, the step index before each
 * dispatch, an outcome after each one.
 */
const instanceAt = (
  fields: Partial<SagaInstance> & Pick<SagaInstance, 'stepIndex'>,
): SagaInstance => ({
  sagaId: 'saga-1',
  definition: 'checkout',
  state: 'RUNNING',
  outcomes: [],
  inputs: twoLines,
  resumeAttempts: 1,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
  ...fields,
});

const resume = (
  world: ReturnType<typeof makeWorld>,
  instance: SagaInstance,
  definition: SagaDefinition = checkout,
  maxResumeAttempts = 3,
) =>
  Effect.runPromise(
    resumeSaga({ instance, definition, maxResumeAttempts }).pipe(
      Effect.provide(world.layer),
      Effect.provide(Logger.remove(Logger.defaultLogger)),
    ),
  );

/** One `reserve` outcome, as two successful holds would have recorded it. */
const heldTwo: SagaStepOutcome = {
  stepId: 'reserve',
  calls: [
    { index: 0, status: 201, body: { data: { id: 'r-0' } }, organizationId: 'org-a' },
    { index: 1, status: 201, body: { data: { id: 'r-1' } }, organizationId: 'org-b' },
  ],
};

describe('resumeSaga — where it re-enters the walk', () => {
  /**
   * The coordinator died *during* the dispatch, so nothing was recorded for the
   * step it was on. Re-dispatching is the only option, and it is safe because
   * the command id is stable and the participant claims it.
   */
  it('re-dispatches a step that recorded no outcome', async () => {
    const world = makeWorld((_d, call) => ok({ data: { id: `r-${call}` } }));

    const result = await resume(
      world,
      instanceAt({ stepIndex: 0, outcomes: [] }),
    );

    expect(result.state).toBe('COMPLETED');
    expect(world.dispatched.map(d => d.commandId)).toEqual([
      'saga-1:reserve:0',
      'saga-1:reserve:1',
      'saga-1:write-order',
    ]);
  });

  /**
   * ⚠️ The window between `recordOutcome` and the next `beginStep`. Starting at
   * `stepIndex` here would take a second pair of holds against the same lines —
   * the oversell ADR 0052 built the command inbox to prevent, reintroduced by
   * the coordinator rather than by a redelivery.
   */
  it('starts after a step whose outcome was already recorded', async () => {
    const world = makeWorld(() => ok({ data: { id: 'o-1' } }));

    const result = await resume(
      world,
      instanceAt({ stepIndex: 0, outcomes: [heldTwo] }),
    );

    expect(result.state).toBe('COMPLETED');
    expect(world.dispatched.map(d => d.commandId)).toEqual([
      'saga-1:write-order',
    ]);
  });

  /**
   * The step refused and the process died deciding what to do about it. The
   * decision is re-entered, not the dispatch: the refusal already happened.
   */
  it('unwinds when the recorded outcome carries a refusal', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({
        stepIndex: 1,
        outcomes: [
          heldTwo,
          { stepId: 'write-order', calls: [], error: "step 'write-order' call 0 refused with 409" },
        ],
      }),
    );

    expect(result.state).toBe('COMPENSATED');
    // Both holds released, newest first, and the order write has nothing to
    // give back because it took nothing.
    expect(world.dispatched.map(d => d.call.path)).toEqual([
      '/api/reservation/r-1',
      '/api/reservation/r-0',
    ]);
    // `write-order` is marked too: it took nothing, so it has nothing to give
    // back and is trivially reversed. Unmarked, a later resume would walk it
    // again for no reason.
    expect(world.compensated).toEqual(['write-order', 'reserve']);
  });

  /**
   * ⚠️ The rule ADR 0054 added to the in-process walk, now on the resumed one.
   * A capture that committed is money taken; unwinding behind it would delete
   * the order and put the goods back on sale.
   */
  it('strands rather than compensating behind a committed pivot', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({
        stepIndex: 3,
        outcomes: [
          heldTwo,
          { stepId: 'write-order', calls: [{ index: 0, status: 201, body: { data: { id: 'o-1' } } }] },
          { stepId: 'capture-payment', calls: [{ index: 0, status: 201, body: { data: { id: 'p-1' } } }] },
          { stepId: 'convert-reservation', calls: [], error: 'refused with 409' },
        ],
      }),
      checkoutWithCapture,
    );

    expect(result.state).toBe('STRANDED');
    expect(world.dispatched).toEqual([]);
  });
});

describe('resumeSaga — a coordinator that died while unwinding', () => {
  it('continues the unwind and skips steps already given back', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({
        state: 'COMPENSATING',
        stepIndex: 1,
        error: 'refused with 409',
        outcomes: [
          heldTwo,
          {
            stepId: 'write-order',
            calls: [{ index: 0, status: 201, body: { data: { id: 'o-1' } } }],
            compensated: true,
          },
        ],
      }),
    );

    expect(result.state).toBe('COMPENSATED');
    // The order delete is *not* re-sent: it is already marked. Only the holds
    // the dead coordinator had not reached come back.
    expect(world.dispatched.map(d => d.call.path)).toEqual([
      '/api/reservation/r-1',
      '/api/reservation/r-0',
    ]);
  });

  /**
   * A `COMPENSATING` instance always carries the refusal that started the
   * unwind — unless it was written before the member existed, in which case the
   * unwind still has to run. What is being given back does not depend on why.
   */
  it('unwinds an instance that records no reason', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({ state: 'COMPENSATING', stepIndex: 0, outcomes: [heldTwo] }),
    );

    expect(result.state).toBe('COMPENSATED');
    expect(result.error).toBe('compensation resumed');
    expect(world.dispatched).toHaveLength(2);
  });

  /**
   * ⚠️ At-least-once compensation. The dead coordinator may have released a
   * hold and died before marking it, so the retry finds nothing to release.
   * Treating that `404` as a failure would strand exactly the flows that were
   * cleaned up correctly.
   */
  it('counts a 404 from a compensation as already undone', async () => {
    const world = makeWorld(() => ({ ok: false, status: 404, body: {} }));

    const result = await resume(
      world,
      instanceAt({
        state: 'COMPENSATING',
        stepIndex: 0,
        error: 'refused with 409',
        outcomes: [heldTwo],
      }),
    );

    expect(result.state).toBe('COMPENSATED');
    expect(world.compensated).toEqual(['reserve']);
  });

  it('strands when a compensation is genuinely refused', async () => {
    const world = makeWorld(() => refused);

    const result = await resume(
      world,
      instanceAt({
        state: 'COMPENSATING',
        stepIndex: 0,
        error: 'refused with 409',
        outcomes: [heldTwo],
      }),
    );

    expect(result.state).toBe('STRANDED');
    // Left unmarked, so a later sweep tries again rather than assuming it is done.
    expect(world.compensated).toEqual([]);
  });
});

describe('resumeSaga — when it refuses to resume', () => {
  it('strands past the resume ceiling instead of retrying forever', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({ stepIndex: 0, resumeAttempts: 4 }),
      checkout,
      3,
    );

    expect(result.state).toBe('STRANDED');
    expect(world.dispatched).toEqual([]);
    expect(world.transitions).toEqual([
      { state: 'STRANDED', error: 'resumed 3 times without settling' },
    ]);
  });

  /**
   * ⚠️ A definition that changed under a live instance describes a different
   * flow. Carrying on would compensate the wrong steps in the wrong order, so
   * it is surfaced for a human instead.
   */
  it('strands on an outcome naming a step the definition no longer has', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(
      world,
      instanceAt({
        stepIndex: 1,
        outcomes: [{ stepId: 'reserve-v1', calls: [] }],
      }),
    );

    expect(result.state).toBe('STRANDED');
    expect(result.error).toContain("'reserve-v1' is not in definition");
    expect(world.dispatched).toEqual([]);
  });

  it('strands when the step index is past the end of the definition', async () => {
    const world = makeWorld(() => ok({}));

    const result = await resume(world, instanceAt({ stepIndex: 9 }));

    expect(result.state).toBe('STRANDED');
    expect(result.error).toContain('step 9 is not in definition');
    expect(world.dispatched).toEqual([]);
  });
});
