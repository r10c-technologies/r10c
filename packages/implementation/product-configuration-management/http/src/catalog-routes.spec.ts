import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  EntifixConnError,
  type EntifixError,
  EntifixLockError,
} from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { EventSourceTag } from '@entifix/transactions';
import {
  OfferingCatalogTag,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { catalogRoutes } from './catalog-routes.js';

const offeringOf = (
  id: string,
  status: ProductOffering['status'],
  specificationId = 'spec-1',
) =>
  Object.assign(new ProductOffering(`Offering ${id}`, specificationId), {
    id,
    status,
  });

const offerings = makeInMemoryEntityRepository([
  offeringOf('o-draft', 'draft'),
  offeringOf('o-free', 'draft'),
  offeringOf('o-ghost', 'draft', 'spec-gone'),
  offeringOf('o-live', 'published'),
  offeringOf('o-race', 'draft'),
  offeringOf('o-lost', 'draft'),
]);
const prices = makeInMemoryEntityRepository(
  ['o-draft', 'o-ghost', 'o-live', 'o-race', 'o-lost'].map(offeringId =>
    Object.assign(new ProductOfferingPrice(), {
      id: `price-${offeringId}`,
      offeringId,
      amount: 100,
      currency: 'GTQ',
    }),
  ),
);
const specifications = makeInMemoryEntityRepository([
  Object.assign(new ProductSpecification(), { id: 'spec-1', name: 'A mug' }),
]);

let storeDown = false;
let accepted: Effect.Effect<{ transactionId: string }, EntifixError> =
  Effect.succeed({ transactionId: 't-1' });

const vendor: TokenClaims = {
  userId: 'u-1',
  subject: 'alan',
  sessionId: 's-1',
  roles: ['admin'],
  activeOrganizationId: 'acme',
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    catalogRoutes,
    Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: entity =>
          storeDown
            ? Effect.fail(new EntifixConnError('store down'))
            : Effect.succeed(
                (entity as unknown) === ProductOffering
                  ? offerings
                  : (entity as unknown) === ProductOfferingPrice
                    ? prices
                    : specifications,
              ),
      }),
      Layer.succeed(OfferingCatalogTag, {
        // `o-lost` loses its race: another transition landed first.
        commitTransition: (_organizationId, offering) =>
          Effect.succeed(
            offering.id === 'o-lost'
              ? ('changed' as const)
              : ('committed' as const),
          ),
        reannounce: () => Effect.succeed('announced' as const),
      }),
      Layer.succeed(SpecificationCommandsTag, { accept: () => accepted }),
      Layer.succeed(EventSourceTag, 'marketplace-admin'),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          token === 'vendor'
            ? Effect.succeed(vendor)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({
          admin: ['product-configuration-management:*:*'],
        }),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const send = (method: string, path: string, body?: unknown) =>
  served.call(path, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer vendor',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const codeOf = async (response: Response) =>
  ((await response.json()) as { code?: string }).code;

describe('POST /api/product-specification', () => {
  it('accepts the command with 202 and a status link to watch', async () => {
    const response = await send('POST', '/api/product-specification', {});

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      meta: {
        type: 'transactionAccepted',
        links: [{ rel: 'status', href: '/api/transaction/t-1' }],
      },
      data: { transactionId: 't-1', state: 'PENDING' },
    });
  });

  it('answers a held lock with 409, a refused command with its rule, and a store failure with 500', async () => {
    const answers: [Effect.Effect<never, EntifixError>, number, string?][] = [
      [Effect.fail(new EntifixLockError('held')), 409, 'resourceBusy'],
      [
        Effect.fail(
          Object.assign(new EntifixBuildError('media refused'), {
            code: 'mediaNotHttps',
          }),
        ),
        400,
        'mediaNotHttps',
      ],
      [Effect.fail(new EntifixBuildError('no name')), 400, 'invalidCommand'],
      [Effect.fail(new EntifixConnError('down')), 500],
    ];
    for (const [answer, status, code] of answers) {
      accepted = answer;
      const response = await send('POST', '/api/product-specification', {});

      expect(response.status).toBe(status);
      if (code !== undefined) expect(await codeOf(response)).toBe(code);
    }
    accepted = Effect.succeed({ transactionId: 't-1' });
  });

  it('refuses unsafe media on the update too', async () => {
    const response = await send('PUT', '/api/product-specification/spec-1', {
      meta: { type: 'entity', entity: 'product-specification' },
      data: {
        name: 'A mug',
        media: [{ url: 'http://cdn.example/a.jpg', alt: 'A' }],
      },
    });

    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe('mediaNotHttps');
  });
});

describe('saving an offering', () => {
  const body = (data: Record<string, unknown>) => ({
    meta: { type: 'entity', entity: 'product-offering' },
    data,
  });

  it('keeps the stored status whatever the body claims, and starts a new one at draft', async () => {
    const updated = await send(
      'PUT',
      '/api/product-offering/o-live',
      body({ name: 'Renamed', specificationId: 'spec-1', status: 'draft' }),
    );
    const created = await send(
      'POST',
      '/api/product-offering',
      body({ name: 'New', specificationId: 'spec-1', status: 'published' }),
    );

    expect(
      ((await updated.json()) as { data: { status: string } }).data.status,
    ).toBe('published');
    expect(
      ((await created.json()) as { data: { status: string } }).data.status,
    ).toBe('draft');
  });

  it('answers a store it cannot open with 500', async () => {
    storeDown = true;
    const response = await send(
      'PUT',
      '/api/product-offering/o-live',
      body({ name: 'x', specificationId: 'spec-1' }),
    );
    storeDown = false;

    expect(response.status).toBe(500);
  });
});

describe('publishing and unpublishing', () => {
  it('publishes one offering, answering it with its links', async () => {
    const response = await send(
      'POST',
      '/api/product-offering/o-draft/publish',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: 'o-draft', status: 'published' },
    });
  });

  it('answers each refusal with the 409 that names it', async () => {
    const refusals = await Promise.all(
      [
        '/api/product-offering/o-free/unpublish',
        '/api/product-offering/o-free/publish',
        '/api/product-offering/o-ghost/publish',
        '/api/product-offering/o-lost/publish',
      ].map(async path => {
        const response = await send('POST', path);
        return [response.status, await codeOf(response)];
      }),
    );

    expect(refusals).toEqual([
      [409, 'illegalOfferingTransition'],
      [409, 'offeringHasNoPrice'],
      [409, 'offeringHasNoSpecification'],
      [409, 'offeringChanged'],
    ]);
  });

  it('answers a store failure with 500', async () => {
    storeDown = true;
    const response = await send('POST', '/api/product-offering/o-race/publish');
    storeDown = false;

    expect(response.status).toBe(500);
  });

  it('transitions a selection row by row, and refuses a body that is not one', async () => {
    const outcomes = await send('POST', '/api/product-offering/unpublish', {
      selection: { mode: 'ids', ids: ['o-live', 'o-free'] },
    });
    const malformed = await send('POST', '/api/product-offering/publish', {
      selection: 'all',
    });
    storeDown = true;
    const failed = await send('POST', '/api/product-offering/publish', {
      selection: { mode: 'matching', total: 1, excluded: [] },
    });
    storeDown = false;

    expect(await outcomes.json()).toEqual({
      meta: { type: 'bulkOutcome', entity: 'product-offering' },
      data: [
        { id: 'o-live', ok: true },
        { id: 'o-free', ok: false, code: 'illegalOfferingTransition' },
      ],
    });
    expect(malformed.status).toBe(400);
    expect(failed.status).toBe(500);
  });
});
