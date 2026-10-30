import { RequestPrincipalTag } from '@entifix/business';
import { EntifixConnError, Unavailable } from '@entifix/core';
import { makeInMemorySagaStore } from '@entifix/testing-unit';
import {
  SagaDispatcherTag,
  type SagaInstance,
  type SagaResponse,
  SagaStoreTag,
} from '@entifix/transactions';
import { Cause, Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  readInputs,
  sagaEndpoints,
  sagaInstanceEndpoint as readInstance,
  sagaRunEndpoints,
} from './saga-endpoints.js';

const [checkout, cancellation] = sagaRunEndpoints as [
  (typeof sagaRunEndpoints)[number],
  (typeof sagaRunEndpoints)[number],
];

interface WorldOptions {
  /** How every call a dispatch reaches answers, by path. */
  readonly answer?: (path: string) => SagaResponse | 'unreachable';
  readonly instances?: readonly SagaInstance[];
  readonly storeDown?: boolean;
  readonly organizationId?: string;
}

const world = async (options: WorldOptions = {}) => {
  const sagas = makeInMemorySagaStore();
  for (const instance of options.instances ?? []) {
    await Effect.runPromise(sagas.start(instance));
  }
  const layer = Layer.mergeAll(
    Layer.succeed(
      SagaStoreTag,
      options.storeDown === true
        ? { ...sagas, get: () => Effect.fail(new Unavailable({})) }
        : sagas,
    ),
    Layer.succeed(SagaDispatcherTag, {
      dispatch: dispatched => {
        const answer =
          options.answer?.(dispatched.call.path) ??
          ({ ok: true, status: 200, body: { data: { id: 'x-1' } } } as const);
        return answer === 'unreachable'
          ? Effect.fail(new EntifixConnError('participant down'))
          : Effect.succeed(answer);
      },
    }),
    Layer.succeed(RequestPrincipalTag, {
      userId: 'u-1',
      subject: 'alan',
      sessionId: 's-1',
      roles: ['admin'],
      attributes: {},
      ...(options.organizationId === undefined
        ? {}
        : { organizationId: options.organizationId }),
    }),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromiseExit(
      Effect.provide(effect, layer as never) as Effect.Effect<A, E, never>,
    );
};

const INPUTS = {
  inputs: {
    reserve: [{ organizationId: 'acme', body: { offeringId: 'o-1' } }],
    'write-order': [{ body: {} }],
    'capture-payment': [{ body: {} }],
  },
};

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : undefined;

describe('readInputs', () => {
  it('reads an object of step id to calls, and nothing else', () => {
    expect(readInputs(INPUTS)).toEqual(INPUTS.inputs);
    for (const body of [
      'not an object',
      { inputs: 'nope' },
      { inputs: { reserve: [7] } },
      { inputs: { reserve: 'x' } },
    ]) {
      expect(readInputs(body)).toBeUndefined();
    }
  });
});

describe('starting a flow', () => {
  it('serves one start per registered flow, each behind its own permission', () => {
    expect(
      sagaEndpoints.map(({ descriptor }) => [
        descriptor.path,
        descriptor.guard,
      ]),
    ).toEqual([
      [
        '/api/saga/checkout',
        {
          kind: 'crossing',
          permission: 'order-management:product-order:write',
          organization: false,
        },
      ],
      [
        '/api/saga/cancellation',
        {
          kind: 'crossing',
          permission: 'order-management:product-order:write',
          organization: false,
        },
      ],
      ['/api/saga/:id', { kind: 'session' }],
    ]);
  });

  it('answers a completed flow with its result and a server-minted id', async () => {
    const exit = await (await world())(checkout.handler({ payload: INPUTS }));

    expect(Exit.isSuccess(exit) && exit.value).toMatchObject({
      meta: { type: 'sagaResult', entity: 'checkout' },
      data: { sagaId: expect.any(String), state: 'COMPLETED' },
    });
  });

  it('answers a compensated flow with the step that refused, and a stranded one as a fault', async () => {
    const compensated = await (
      await world({
        answer: path =>
          path === '/api/reservation'
            ? { ok: false, status: 409, body: { code: 'insufficientStock' } }
            : { ok: true, status: 200, body: { data: { id: 'x' } } },
      })
    )(checkout.handler({ payload: INPUTS }));
    const stranded = await (
      await world({
        answer: path =>
          path.endsWith('/conversion')
            ? { ok: false, status: 409, body: {} }
            : { ok: true, status: 200, body: { data: { id: 'x' } } },
      })
    )(checkout.handler({ payload: INPUTS }));

    expect(failureOf(compensated)).toMatchObject({
      value: { _tag: 'SagaCompensated', refusedStep: 'reserve' },
    });
    expect(failureOf(stranded)).toMatchObject({
      value: { _tag: 'SagaStranded' },
    });
  });

  it('refuses malformed inputs, and dies on an uncategorised engine failure', async () => {
    const run = await world({ answer: () => 'unreachable' });

    const malformed = await run(
      cancellation.handler({ payload: { inputs: 'nope' } }),
    );
    const broken = await run(checkout.handler({ payload: INPUTS }));

    expect(failureOf(malformed)).toMatchObject({
      value: { _tag: 'InvalidBody' },
    });
    expect(Exit.isFailure(broken) && Cause.hasDies(broken.cause)).toBe(true);
  });
});

const instance = (organizationId?: string): SagaInstance =>
  ({
    sagaId: 'saga-1',
    definition: 'checkout',
    state: 'COMPLETED',
    outcomes: [
      {
        stepId: 'reserve',
        calls: [{ organizationId }, { organizationId: undefined }],
      },
    ],
    startedAt: '2026-10-25T10:00:00.000Z',
  }) as unknown as SagaInstance;

describe('reading a flow', () => {
  const read = (id = 'saga-1') => readInstance.handler({ params: { id } });

  it('serves a flow to an organization one of its calls named, and answers anyone else as absent', async () => {
    const named = await (
      await world({ instances: [instance('acme')], organizationId: 'acme' })
    )(read());
    const elsewhere = await (
      await world({ instances: [instance('acme')], organizationId: 'globex' })
    )(read());
    const unscoped = await (
      await world({ instances: [instance('acme')] })
    )(read());
    const missing = await (
      await world({ organizationId: 'acme' })
    )(read('saga-9'));

    expect(Exit.isSuccess(named) && named.value).toMatchObject({
      meta: { type: 'sagaInstance', entity: 'checkout' },
    });
    for (const absent of [elsewhere, unscoped, missing]) {
      expect(failureOf(absent)).toMatchObject({ value: { _tag: 'NotFound' } });
    }
  });

  it('answers a flow no call scoped as absent, and fails when the store does', async () => {
    const unowned = await (
      await world({ instances: [instance()], organizationId: 'acme' })
    )(read());
    const broken = await (
      await world({ storeDown: true, organizationId: 'acme' })
    )(read());

    expect(failureOf(unowned)).toMatchObject({ value: { _tag: 'NotFound' } });
    expect(failureOf(broken)).toMatchObject({ value: { _tag: 'Unavailable' } });
  });
});
