import {
  type EntityApiContext,
  EntityRepositoryFactoryTag,
  IdempotencyKeyTag,
} from '@entifix/business';
import { makeEntityEnvelope, toWireSelection } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { EventSourceTag } from '@entifix/transactions';
import {
  OfferingCatalogTag,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  SpecificationCommandsTag,
} from '@r10c/business-ts-product-configuration-management';
import {
  makeInMemoryOfferingCatalog,
  makeInMemorySpecificationCommands,
} from '@r10c/business-ts-product-configuration-management/testing';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  productOfferingApi,
  productOfferingPriceApi,
  productSpecificationApi,
} from './catalog-api.js';

const context: EntityApiContext = {
  organizationId: 'acme',
  links: {
    record: id => [{ rel: 'self', href: `/x/${String(id)}` }],
    collection: () => [],
  },
};

const offering = (id: string, status: ProductOffering['status']) =>
  Object.assign(new ProductOffering(`Offering ${id}`, 'spec-1'), {
    id,
    status,
  });

/** Two offerings, one priced and one not, both drafts naming one specification. */
const world = () => {
  const offerings = makeInMemoryEntityRepository([
    offering('priced', 'draft'),
    offering('unpriced', 'draft'),
  ]);
  const prices = makeInMemoryEntityRepository([
    Object.assign(new ProductOfferingPrice(), {
      id: 'price-1',
      offeringId: 'priced',
      amount: 1999,
      currency: 'GTQ',
    }),
  ]);
  const versions = [
    { id: 'spec-1', lifecycleStatus: 'active' },
    { id: 'spec-draft', lifecycleStatus: 'in-design' },
    { id: 'spec-old', lifecycleStatus: 'retired' },
  ] as const;
  const specifications = makeInMemoryEntityRepository(
    versions.map(({ id, lifecycleStatus }) =>
      Object.assign(new ProductSpecification('product-001', 'A widget'), {
        id,
        specKey: id === 'spec-1' ? 'product-001' : 'product-002',
        version: 1,
        lifecycleStatus,
        // The revision the commands hold a seeded version at.
        revision: 1,
      }),
    ),
  );
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: entity =>
        Effect.succeed(
          (entity as unknown) === ProductOffering
            ? offerings
            : (entity as unknown) === ProductOfferingPrice
              ? prices
              : specifications,
        ),
    }),
    Layer.succeed(
      OfferingCatalogTag,
      makeInMemoryOfferingCatalog({
        acme: [
          { id: 'priced', status: 'draft' },
          { id: 'unpriced', status: 'draft' },
        ],
      }),
    ),
    Layer.succeed(
      SpecificationCommandsTag,
      makeInMemorySpecificationCommands({
        acme: versions.map(({ id, lifecycleStatus }) => ({
          id,
          specKey: id === 'spec-1' ? 'product-001' : 'product-002',
          version: 1,
          lifecycleStatus,
        })),
      }),
    ),
    Layer.succeed(EventSourceTag, 'marketplace-admin'),
  );
  return <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.runPromise(
      Effect.result(
        Effect.provide(effect, layer as never),
      ) as unknown as Effect.Effect<
        { _tag: string; success?: unknown; failure?: unknown },
        never,
        never
      >,
    );
};

const [publish, unpublish] = productOfferingApi.options.useCases;
const [release, revise, retire, obsolete] =
  productSpecificationApi.options.useCases;
const updating = { ...context, verb: 'update' as const };
const selected = (...ids: string[]) => ({
  payload: { selection: toWireSelection({ mode: 'ids', ids: new Set(ids) }) },
});

describe('the catalog declarations', () => {
  it('bind every endpoint to the caller’s organization', () => {
    for (const api of [
      productSpecificationApi,
      productOfferingApi,
      productOfferingPriceApi,
    ]) {
      expect(api.options.guard).toEqual({ kind: 'organization' });
    }
    expect(productSpecificationApi.options.override.create.idempotent).toBe(
      'unit',
    );
  });
});

describe('a specification', () => {
  const create = (media: unknown[], key?: string) => {
    const handler = productSpecificationApi.options.override.create.handler(
      {
        payload: makeEntityEnvelope(
          ProductSpecification,
          Object.assign(new ProductSpecification(), {
            name: 'A widget',
            media,
          }),
        ),
      },
      context,
    );
    return key === undefined
      ? handler
      : Effect.provideService(handler, IdempotencyKeyTag, key);
  };

  it('is created under its key, and refused media writes nothing', async () => {
    const run = world();

    const created = await run(create([], 'key-1'));
    const refused = await run(create([{ url: 'http://x', alt: 'x' }]));

    expect(created).toMatchObject({ _tag: 'Success' });
    expect(refused).toMatchObject({
      _tag: 'Failure',
      failure: { code: 'mediaNotHttps' },
    });
  });

  it('is checked for its media on update too', async () => {
    const run = world();
    const prepare = productSpecificationApi.options.prepare;

    expect(
      await run(
        prepare(
          Object.assign(new ProductSpecification(), {
            media: [{ url: 'https://x/a.png' }],
          }),
          updating,
        ),
      ),
    ).toMatchObject({ failure: { code: 'mediaAltMissing' } });
  });

  it('refuses universal beside a model, on create and on update', async () => {
    const run = world();
    const fits = ['device-model-1', 'universal'];
    const handler = productSpecificationApi.options.override.create.handler(
      {
        payload: makeEntityEnvelope(
          ProductSpecification,
          Object.assign(new ProductSpecification(), {
            name: 'A case',
            fitsDeviceModelIds: fits,
          }),
        ),
      },
      context,
    );

    expect(await run(handler)).toMatchObject({
      failure: { code: 'deviceModelUniversalNotAlone' },
    });
    expect(
      await run(
        productSpecificationApi.options.prepare(
          Object.assign(new ProductSpecification(), {
            fitsDeviceModelIds: fits,
          }),
          updating,
        ),
      ),
    ).toMatchObject({ failure: { code: 'deviceModelUniversalNotAlone' } });
  });
});

describe('a specification version', () => {
  it('is created as the first version of its own series, in design', async () => {
    const run = world();

    const created = await run(
      productSpecificationApi.options.override.create.handler(
        {
          payload: makeEntityEnvelope(
            ProductSpecification,
            Object.assign(new ProductSpecification(), {
              name: 'A widget',
              lifecycleStatus: 'active',
              version: 9,
            }),
          ),
        },
        context,
      ),
    );

    expect(created).toMatchObject({
      success: {
        data: {
          code: 'product-001',
          specKey: 'product-001',
          version: 1,
          lifecycleStatus: 'in-design',
        },
      },
    });
  });

  it('is edited only while in design, its lifecycle carried across', async () => {
    const run = world();
    const body = (id: string) =>
      Object.assign(new ProductSpecification('', 'Renamed'), {
        id,
        lifecycleStatus: 'obsolete',
      });

    const edited = await run(
      productSpecificationApi.options.prepare(body('spec-draft'), updating),
    );
    const refused = await run(
      productSpecificationApi.options.prepare(body('spec-1'), updating),
    );

    expect(edited).toMatchObject({
      success: {
        name: 'Renamed',
        code: 'product-001',
        lifecycleStatus: 'in-design',
      },
    });
    expect(refused).toMatchObject({
      failure: { code: 'specificationReleased', standing: 'active' },
    });
  });

  it('is released, revised, retired and made obsolete by its verbs', async () => {
    const run = world();

    const released = await run(
      release.handler({ params: { id: 'spec-draft' } }, context),
    );
    const next = await run(
      revise.handler({ params: { id: 'spec-1' } }, context),
    );
    const retired = await run(
      retire.handler({ params: { id: 'spec-1' } }, context),
    );
    const obsoleted = await run(
      obsolete.handler({ params: { id: 'spec-old' } }, context),
    );

    expect(released).toMatchObject({
      success: { data: { id: 'spec-draft', lifecycleStatus: 'active' } },
    });
    expect(next).toMatchObject({
      success: {
        data: {
          specKey: 'product-001',
          version: 2,
          lifecycleStatus: 'in-design',
        },
      },
    });
    expect(retired).toMatchObject({
      success: { data: { lifecycleStatus: 'retired' } },
    });
    expect(obsoleted).toMatchObject({
      success: { data: { lifecycleStatus: 'obsolete' } },
    });
  });

  it('is deleted only while in design', async () => {
    const run = world();
    const remove = (id: string) =>
      run(
        productSpecificationApi.options.override.delete.handler(
          { params: { id } },
          context,
        ),
      );

    expect(await remove('spec-draft')).toMatchObject({
      success: {
        meta: { type: 'entity', entity: 'product-specification' },
        data: { id: 'spec-draft' },
      },
    });
    expect(await remove('spec-1')).toMatchObject({
      failure: { code: 'specificationReleased' },
    });
    expect(await remove('spec-draft')).toMatchObject({
      failure: { code: 'notFound' },
    });
  });
});

describe('an offering', () => {
  it('publishes one record, and refuses one with no price', async () => {
    const run = world();

    const published = await run(
      publish.handler({ params: { id: 'priced' } }, context),
    );
    const refused = await run(
      publish.handler({ params: { id: 'unpriced' } }, context),
    );

    expect(published).toMatchObject({
      success: { data: { id: 'priced', status: 'published' } },
    });
    expect(refused).toMatchObject({ failure: { code: 'offeringHasNoPrice' } });
  });

  it('publishes a selection row by row, and refuses a body that is not one', async () => {
    const run = world();

    const outcomes = await run(
      publish.bulk?.(selected('priced', 'unpriced'), context) ??
        Effect.die('no bulk'),
    );
    const malformed = await run(
      unpublish.bulk?.({ payload: { selection: 'all' } }, context) ??
        Effect.die('no bulk'),
    );

    expect(outcomes).toMatchObject({
      success: {
        meta: { type: 'bulkOutcome', entity: 'product-offering' },
        data: [
          { id: 'priced', ok: true },
          { id: 'unpriced', ok: false, code: 'offeringHasNoPrice' },
        ],
      },
    });
    expect(malformed).toMatchObject({ failure: { code: 'invalidBody' } });
  });

  it('keeps the stored status across a save, whatever the body said', async () => {
    const run = world();

    const saved = await run(
      productOfferingApi.options.prepare(offering('priced', 'published'), {
        ...context,
        verb: 'update',
      }),
    );

    expect(saved).toMatchObject({ success: { status: 'draft' } });
  });
});
