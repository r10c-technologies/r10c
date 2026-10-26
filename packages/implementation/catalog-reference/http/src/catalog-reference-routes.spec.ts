import { makeStaticPolicyDecision, PolicyDecisionTag } from '@entifix/authz';
import {
  EntityRepositoryFactoryTag,
  type TokenClaims,
  TokenServiceTag,
} from '@entifix/business';
import { EntifixBuildError, EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  CATEGORY_HAS_CHILDREN,
  CATEGORY_PARENT_MISSING,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { type ServedRoutes, serveRoutes } from '@r10c/testing-http';
import { Effect, Layer } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { catalogReferenceRoutes } from './catalog-reference-routes.js';

const brand = (id: string) =>
  Object.assign(new ProductBrand(id), { id, status: 'active' as const });

const category = (id: string, parentId?: string) =>
  Object.assign(new ProductCategory(id, id), {
    id,
    status: 'active' as const,
    ...(parentId === undefined ? {} : { parentId }),
  });

const brands = makeInMemoryEntityRepository([brand('b-1'), brand('b-2')]);
const categories = makeInMemoryEntityRepository([
  category('root'),
  category('leaf', 'root'),
]);
const terms = makeInMemoryEntityRepository();
let storeDown = false;

const operator: TokenClaims = {
  userId: 'u-1',
  subject: 'op',
  sessionId: 's-1',
  roles: ['staff'],
};

let served: ServedRoutes;

beforeAll(() => {
  served = serveRoutes(
    catalogReferenceRoutes,
    Layer.mergeAll(
      Layer.succeed(EntityRepositoryFactoryTag, {
        for: entity =>
          storeDown
            ? Effect.fail(new EntifixConnError('store down'))
            : Effect.succeed(
                (entity as unknown) === ProductBrand
                  ? brands
                  : (entity as unknown) === ProductCategory
                    ? categories
                    : terms,
              ),
      }),
      Layer.succeed(TokenServiceTag, {
        sign: () => Effect.succeed('t'),
        verify: token =>
          token === 'operator'
            ? Effect.succeed(operator)
            : Effect.fail(new EntifixBuildError('bad token')),
      }),
      Layer.succeed(
        PolicyDecisionTag,
        makeStaticPolicyDecision({ staff: ['catalog-reference:*:*'] }),
      ),
    ),
  );
});

afterAll(async () => {
  await served.dispose();
});

const send = (method: string, path: string, body?: unknown, who?: string) =>
  served.call(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who ? { authorization: `Bearer ${who}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const envelope = (entity: string, data: Record<string, unknown>) => ({
  meta: { type: 'entity', entity },
  data,
});

describe('the vocabulary', () => {
  it('is read by anyone, and written only behind its permission', async () => {
    const read = await send('GET', '/api/product-brand');
    const anonymous = await send(
      'POST',
      '/api/dictionary-term',
      envelope('dictionary-term', { code: 'colour' }),
    );

    expect(read.status).toBe(200);
    expect(anonymous.status).toBe(401);
  });
});

describe('saving a category', () => {
  it('saves where the tree allows it, and answers 409 naming the rule where it does not', async () => {
    const saved = await send(
      'POST',
      '/api/product-category',
      envelope('product-category', {
        code: 'twig',
        name: 'twig',
        parentId: 'leaf',
      }),
      'operator',
    );
    const orphan = await send(
      'POST',
      '/api/product-category',
      envelope('product-category', {
        code: 'lost',
        name: 'lost',
        parentId: 'ghost',
      }),
      'operator',
    );

    expect(saved.status).toBe(200);
    expect(orphan.status).toBe(409);
    expect(await orphan.json()).toMatchObject({
      code: CATEGORY_PARENT_MISSING,
    });
  });

  it('refuses to save past the rule when the tree cannot be read', async () => {
    storeDown = true;
    const response = await send(
      'POST',
      '/api/product-category',
      envelope('product-category', { code: 'x', name: 'x' }),
      'operator',
    );
    storeDown = false;

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'categoryTreeUnreadable',
    });
  });
});

describe('retiring a selection', () => {
  const selection = (ids: string[]) => ({ selection: { mode: 'ids', ids } });

  it('retires and restores brands, reporting an outcome per row', async () => {
    const retired = await send(
      'POST',
      '/api/product-brand/retire',
      selection(['b-1']),
      'operator',
    );
    const restored = await send(
      'POST',
      '/api/product-brand/restore',
      selection(['b-1']),
      'operator',
    );

    expect(await retired.json()).toEqual({
      meta: { type: 'bulkOutcome', entity: 'product-brand' },
      data: [{ id: 'b-1', ok: true }],
    });
    expect(((await restored.json()) as { data: unknown }).data).toEqual([
      { id: 'b-1', ok: true },
    ]);
  });

  it('refuses to retire a category with active children', async () => {
    const response = await send(
      'POST',
      '/api/product-category/retire',
      selection(['root']),
      'operator',
    );

    expect(((await response.json()) as { data: unknown }).data).toEqual([
      { id: 'root', ok: false, code: CATEGORY_HAS_CHILDREN },
    ]);
  });

  it('refuses a body that is not a selection, and answers a store failure with 500', async () => {
    const malformed = await send(
      'POST',
      '/api/product-brand/retire',
      { selection: 'all' },
      'operator',
    );
    storeDown = true;
    const failed = await send(
      'POST',
      '/api/product-brand/retire',
      selection(['b-2']),
      'operator',
    );
    storeDown = false;

    expect(malformed.status).toBe(400);
    expect(failed.status).toBe(500);
  });
});
