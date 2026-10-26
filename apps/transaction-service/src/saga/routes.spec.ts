import {
  makeStaticServiceCrossingPolicy,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { type TokenClaims, TokenServiceTag } from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import {
  CROSSING_TOKEN_HEADER,
  ServiceCrossingTokenTag,
} from '@entifix/service-shell';
import { makeInMemorySagaStore } from '@entifix/testing-unit';
import {
  SagaDispatcherTag,
  type SagaInstance,
  type SagaResponse,
  SagaStoreTag,
  type TransactionRecord,
  TransactionStoreTag,
  TransactionStreamHubTag,
} from '@entifix/transactions';
import { makeTransactionStreamHubEffect } from '@entifix/transactions/engine';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { sagaInstanceRoutes } from './instance-routes.js';
import { sagaRoutes } from './routes.js';
import { sagaRunRoutes } from './run-routes.js';

const served: ServedRoutes[] = [];
afterEach(async () => {
  await Promise.all(served.splice(0).map(one => one.dispose()));
});

const CLAIMS: Record<string, TokenClaims> = {
  acme: {
    userId: 'u-1',
    subject: 'alan',
    sessionId: 's-1',
    roles: ['admin'],
    activeOrganizationId: 'acme',
  },
  nobody: { userId: 'u-2', subject: 'ada', sessionId: 's-2', roles: ['user'] },
};

interface WorldOptions {
  /** How every step a dispatch reaches answers, by step id. */
  readonly answer?: (path: string) => SagaResponse | 'unreachable';
  readonly instances?: readonly SagaInstance[];
  readonly records?: readonly TransactionRecord[];
  readonly storeDown?: boolean;
}

const world = async (options: WorldOptions = {}) => {
  const sagas = makeInMemorySagaStore();
  for (const instance of options.instances ?? []) {
    await Effect.runPromise(sagas.start(instance));
  }
  const hub = await Effect.runPromise(makeTransactionStreamHubEffect);
  const records = new Map(
    (options.records ?? []).map(record => [record.transactionId, record]),
  );
  const down = Effect.fail(new EntifixConnError('store down'));

  const routes = serveRoutes(
    Layer.mergeAll(sagaRunRoutes, sagaInstanceRoutes, sagaRoutes),
    Layer.mergeAll(
      Layer.succeed(
        SagaStoreTag,
        options.storeDown === true ? { ...sagas, get: () => down } : sagas,
      ),
      Layer.succeed(SagaDispatcherTag, {
        dispatch: dispatched => {
          const answer =
            options.answer?.(dispatched.call.path) ??
            ({ ok: true, status: 201, body: { data: { id: 'x-1' } } } as const);
          return answer === 'unreachable'
            ? Effect.fail(new EntifixConnError('unreachable'))
            : Effect.succeed(answer);
        },
      }),
      Layer.succeed(TransactionStoreTag, {
        get: (id: string) =>
          options.storeDown === true ? down : Effect.succeed(records.get(id)),
      } as never),
      Layer.succeed(TransactionStreamHubTag, hub),
      Layer.succeed(ServiceCrossingTokenTag, 'fleet'),
      Layer.succeed(
        ServiceCrossingPolicyTag,
        makeStaticServiceCrossingPolicy([
          'order-management:product-order:write',
        ]),
      ),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: (token: string) =>
          token in CLAIMS
            ? Effect.succeed(CLAIMS[token] as TokenClaims)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
    ),
  );
  served.push(routes);
  return routes;
};

const run = (routes: ServedRoutes, definition: string, body: unknown) =>
  routes.call(`/api/saga/${definition}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: 'fleet',
    },
    body: JSON.stringify(body),
  });

const INPUTS = {
  inputs: {
    reserve: [{ organizationId: 'acme', body: { offeringId: 'o-1' } }],
    'write-order': [{ body: {} }],
    'capture-payment': [{ body: {} }],
  },
};

describe('POST /api/saga/:definition', () => {
  it('answers a completed flow 201, with the result and a server-minted saga id', async () => {
    const response = await run(await world(), 'checkout', INPUTS);
    const body = (await response.json()) as {
      data: { sagaId: string; state: string };
    };

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      sagaId: expect.any(String),
      state: 'COMPLETED',
    });
  });

  it('answers a compensated flow 409, and one stranded past its pivot 500', async () => {
    const compensated = await run(
      await world({
        answer: path =>
          path === '/api/reservation'
            ? { ok: false, status: 409, body: { code: 'insufficientStock' } }
            : { ok: true, status: 200, body: { data: { id: 'x' } } },
      }),
      'checkout',
      INPUTS,
    );
    const stranded = await run(
      await world({
        answer: path =>
          path.endsWith('/conversion')
            ? { ok: false, status: 409, body: {} }
            : { ok: true, status: 201, body: { data: { id: 'x' } } },
      }),
      'checkout',
      INPUTS,
    );

    expect(compensated.status).toBe(409);
    expect(stranded.status).toBe(500);
  });

  it('answers an unknown flow 404, malformed inputs 400, no crossing 401, and an engine failure 500', async () => {
    const routes = await world({ answer: () => 'unreachable' });

    const unknown = await run(routes, 'nonsense', INPUTS);
    const malformed = await Promise.all(
      [
        'not an object',
        { inputs: 'nope' },
        { inputs: { reserve: [7] } },
        { inputs: { reserve: 'x' } },
      ].map(body => run(routes, 'checkout', body)),
    );
    const anonymous = await routes.call('/api/saga/checkout', {
      method: 'POST',
      body: JSON.stringify(INPUTS),
    });
    const failed = await run(routes, 'checkout', INPUTS);

    expect(unknown.status).toBe(404);
    expect(malformed.map(response => response.status)).toEqual([
      400, 400, 400, 400,
    ]);
    expect(anonymous.status).toBe(401);
    expect(failed.status).toBe(500);
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

describe('GET /api/saga/:id', () => {
  const read = (routes: ServedRoutes, token: string, id = 'saga-1') =>
    routes.call(`/api/saga/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it('serves a flow to an organization one of its calls named, and 404s it to anyone else', async () => {
    const routes = await world({ instances: [instance('acme')] });

    const named = await read(routes, 'acme');
    const unscoped = await read(routes, 'nobody');
    const missing = await read(routes, 'acme', 'saga-9');

    expect(named.status).toBe(200);
    expect([unscoped.status, missing.status]).toEqual([404, 404]);
  });

  it('404s a flow no call scoped, and answers 500 when the store fails', async () => {
    const unscopedFlow = await world({ instances: [instance()] });
    const broken = await world({ storeDown: true });

    expect((await read(unscopedFlow, 'acme')).status).toBe(404);
    expect((await read(broken, 'acme')).status).toBe(500);
  });
});

describe('the transaction tracker', () => {
  const record = (organizationId?: string): TransactionRecord =>
    ({
      transactionId: 't-1',
      entity: 'product-specification',
      state: 'COMPLETED',
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: '2026-10-25T10:00:01.000Z',
      ...(organizationId === undefined ? {} : { organizationId }),
    }) as TransactionRecord;

  const get = (routes: ServedRoutes, token: string, path: string) =>
    routes.call(path, { headers: { authorization: `Bearer ${token}` } });

  it('serves a record to its own organization, and 404s it to any other', async () => {
    const routes = await world({ records: [record('acme')] });

    expect((await get(routes, 'acme', '/api/transaction/t-1')).status).toBe(
      200,
    );
    expect((await get(routes, 'nobody', '/api/transaction/t-1')).status).toBe(
      404,
    );
    expect((await get(routes, 'acme', '/api/transaction/t-9')).status).toBe(
      404,
    );
  });

  it('answers 500 when the store fails', async () => {
    const routes = await world({ storeDown: true });

    expect((await get(routes, 'acme', '/api/transaction/t-1')).status).toBe(
      500,
    );
  });

  it('opens the event stream for a scoped session, and an empty one otherwise', async () => {
    const routes = await world();

    const scoped = await get(routes, 'acme', '/api/transaction/events');
    const unscoped = await get(routes, 'nobody', '/api/transaction/events');

    expect(scoped.headers.get('content-type')).toContain('text/event-stream');
    expect(unscoped.status).toBe(200);
    await scoped.body?.cancel();
    await unscoped.body?.cancel();
  });
});
