import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  Agreement,
  type RunOutcome,
  SettlementRunStoreTag,
} from '@r10c/business-ts-settlement-management';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { settlementRoutes } from './settlement-routes.js';

const agreementOf = (id: string, vendorId: string) =>
  Object.assign(new Agreement(vendorId, 1000), { id });

const repository = makeInMemoryEntityRepository([
  agreementOf('a-1', 'v-1'),
  agreementOf('a-2', 'v-2'),
]);

let settle: Effect.Effect<RunOutcome, EntifixConnError> = Effect.succeed({
  kind: 'idle',
});

const sessions: Record<string, TokenClaims> = {
  operator: {
    userId: 'u',
    subject: 'op',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'operator',
  },
  vendor: {
    userId: 'u',
    subject: 'v',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'vendor',
    activeOrganizationId: 'v-1',
  },
  customer: {
    userId: 'u',
    subject: 'c',
    sessionId: 's',
    roles: ['staff'],
    partyRole: 'customer',
  },
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    settlementRoutes,
    Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        // The agreements are seeded; every other record starts empty.
        for: entity =>
          Effect.succeed(
            (entity as unknown) === Agreement
              ? repository
              : makeInMemoryEntityRepository(),
          ),
      }),
      Layer.succeed(SettlementRunStoreTag, { settleOnce: () => settle }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          sessions[token]
            ? Effect.succeed(sessions[token] as TokenClaims)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ staff: ['settlement-management:*:*'] }),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const as = (who: string, path: string, init: RequestInit = {}) =>
  served.call(path, {
    ...init,
    headers: {
      authorization: `Bearer ${who}`,
      'content-type': 'application/json',
    },
  });

const totalFor = async (who: string, path: string) =>
  ((await (await as(who, path)).json()) as { data: { total: number } }).data
    .total;

describe('the scoped reads', () => {
  it('give an operator every agreement, a vendor their own, and anybody else nothing', async () => {
    expect(await totalFor('operator', '/api/agreement')).toBe(2);
    expect(await totalFor('vendor', '/api/agreement')).toBe(1);
    expect(await totalFor('customer', '/api/agreement')).toBe(0);
    expect(await totalFor('vendor', '/api/vendor-payout')).toBe(0);
    expect(await totalFor('vendor', '/api/commission-entry')).toBe(0);
  });

  it('answer another vendor’s agreement as not found', async () => {
    expect((await as('vendor', '/api/agreement/a-1')).status).toBe(200);
    expect((await as('vendor', '/api/agreement/a-2')).status).toBe(404);
  });
});

describe('writing an agreement', () => {
  const body = (data: Record<string, unknown>) =>
    JSON.stringify({ meta: { type: 'entity', entity: 'agreement' }, data });

  it('saves terms within the sale, and refuses a rate outside it', async () => {
    const saved = await as('operator', '/api/agreement', {
      method: 'POST',
      body: body({ vendorId: 'v-3', commissionBasisPoints: 700 }),
    });
    const refused = await as('operator', '/api/agreement', {
      method: 'POST',
      body: body({ vendorId: 'v-3', commissionBasisPoints: 20_000 }),
    });

    expect(saved.status).toBe(200);
    expect(refused.status).toBe(400);
  });
});

describe('POST /api/settlement-run', () => {
  it('settles now, and answers a failed pass with 500', async () => {
    const idle = await as('operator', '/api/settlement-run', {
      method: 'POST',
    });
    settle = Effect.fail(new EntifixConnError('store down'));
    const failed = await as('operator', '/api/settlement-run', {
      method: 'POST',
    });

    expect(await idle.json()).toEqual({
      meta: { type: 'settlementRun' },
      data: { kind: 'idle' },
    });
    expect(failed.status).toBe(500);
  });
});
