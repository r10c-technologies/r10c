import {
  EntityRepositoryFactoryTag,
  TenantDirectoryTag,
} from '@entifix/business';
import { type DomainEvent, EntifixConnError } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import type { CatalogPublication } from '@r10c/business-ts-catalog-contracts';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductOfferingPrice } from '../../entities/product-offering-price/product-offering-price.entity.js';
import { ProductSpecification } from '../../entities/product-specification/product-specification.entity.js';
import {
  type OfferingCatalog,
  OfferingCatalogTag,
} from '../../ports/offering-catalog.js';
import {
  OFFERING_CHANGED,
  preserveOfferingLifecycle,
  rebuildEveryPublication,
  rebuildPublications,
  transitionOfferingFor,
  transitionOfferingSelection,
} from './offering-flows.js';

const SEEDED_AT = new Date('2026-01-01T00:00:00.000Z');

const offering = (
  id: string,
  status: ProductOffering['status'],
  overrides: Partial<ProductOffering> = {},
) =>
  Object.assign(new ProductOffering(`Offering ${id}`, 'spec-1'), {
    id,
    status,
    statusChangedAt: SEEDED_AT,
    ...overrides,
  });

const priceFor = (offeringId: string) =>
  Object.assign(new ProductOfferingPrice(), {
    id: `price-${offeringId}`,
    offeringId,
    amount: 1999,
    currency: 'GTQ',
  });

const specification = () =>
  Object.assign(new ProductSpecification(), { id: 'spec-1', name: 'A widget' });

interface Stores {
  readonly offerings?: ProductOffering[];
  readonly priced?: string[];
  readonly specifications?: ProductSpecification[];
  readonly commit?: 'committed' | 'changed';
  readonly reannounce?: 'announced' | 'revived' | 'alreadyAnnounced';
  readonly offeringsDown?: boolean;
  readonly organizations?: string[];
}

const world = (stores: Stores = {}) => {
  const committed: { organizationId: string; from: string }[] = [];
  const announced: DomainEvent<CatalogPublication>[] = [];
  const offerings = makeInMemoryEntityRepository(stores.offerings ?? []);
  const prices = makeInMemoryEntityRepository(
    (stores.priced ?? (stores.offerings ?? []).map(one => String(one.id))).map(
      priceFor,
    ),
  );
  const specifications = makeInMemoryEntityRepository(
    stores.specifications ?? [specification()],
  );
  const catalog: OfferingCatalog = {
    commitTransition: (organizationId, _offering, from) =>
      Effect.sync(() => {
        committed.push({ organizationId, from });
        return stores.commit ?? 'committed';
      }),
    reannounce: (_organizationId, event) =>
      Effect.sync(() => {
        announced.push(event);
        return stores.reannounce ?? 'announced';
      }),
  };
  const layer = Layer.mergeAll(
    Layer.succeed(EntityRepositoryFactoryTag, {
      for: entity =>
        (entity as unknown) === ProductOffering
          ? stores.offeringsDown
            ? Effect.fail(new EntifixConnError('store down'))
            : Effect.succeed(offerings)
          : Effect.succeed(
              (entity as unknown) === ProductOfferingPrice
                ? prices
                : specifications,
            ),
    }),
    Layer.succeed(OfferingCatalogTag, catalog),
    Layer.succeed(TenantDirectoryTag, {
      list: () =>
        Effect.succeed(
          (stores.organizations ?? ['acme']).map(organizationId => ({
            organizationId,
            handle: undefined,
          })),
        ),
    }),
  );
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      EntityRepositoryFactoryTag | OfferingCatalogTag | TenantDirectoryTag
    >,
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));
  return { run, committed, announced, offerings };
};

const SOURCE = 'marketplace-admin';

describe('transitionOfferingFor', () => {
  it('commits the transition against the status it was read in', async () => {
    const w = world({ offerings: [offering('o-1', 'draft')] });

    const published = await w.run(
      transitionOfferingFor({
        organizationId: 'acme',
        id: 'o-1',
        transition: 'publish',
        source: SOURCE,
      }),
    );

    expect(published.status).toBe('published');
    expect(w.committed).toEqual([{ organizationId: 'acme', from: 'draft' }]);
  });

  it('answers a transition another one beat to the store as changed', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft')],
      commit: 'changed',
    });

    const error = await w.run(
      Effect.flip(
        transitionOfferingFor({
          organizationId: 'acme',
          id: 'o-1',
          transition: 'publish',
          source: SOURCE,
        }),
      ),
    );

    expect((error as { code?: string }).code).toBe(OFFERING_CHANGED);
  });
});

describe('transitionOfferingSelection', () => {
  it('transitions the ids a selection names, answering an outcome per row', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft'), offering('o-2', 'draft')],
      priced: ['o-1'],
    });

    const outcomes = await w.run(
      transitionOfferingSelection({
        organizationId: 'acme',
        selection: { mode: 'ids', ids: new Set(['o-1', 'o-2']) },
        transition: 'publish',
        source: SOURCE,
      }),
    );

    expect(outcomes).toEqual([
      { id: 'o-1', ok: true },
      { id: 'o-2', ok: false, code: 'offeringHasNoPrice' },
    ]);
  });

  it('transitions every matching row but the excluded ones, and names a failure without a code', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft'), offering('o-2', 'draft')],
    });

    const outcomes = await w.run(
      transitionOfferingSelection({
        organizationId: 'acme',
        selection: { mode: 'matching', total: 2, excluded: new Set(['o-2']) },
        transition: 'publish',
        source: SOURCE,
      }),
    );
    const down = await world({ offeringsDown: true }).run(
      transitionOfferingSelection({
        organizationId: 'acme',
        selection: { mode: 'ids', ids: new Set(['o-9']) },
        transition: 'publish',
        source: SOURCE,
      }),
    );

    expect(outcomes).toEqual([{ id: 'o-1', ok: true }]);
    expect(down).toEqual([{ id: 'o-9', ok: false, code: 'unexpected' }]);
  });
});

describe('preserveOfferingLifecycle', () => {
  it('starts a create at draft with no moment, whatever the caller claimed', async () => {
    const created = Object.assign(new ProductOffering('New', 'spec-1'), {
      status: 'published' as const,
      statusChangedAt: new Date(),
    });

    const kept = await world().run(preserveOfferingLifecycle(created, 'acme'));

    expect(kept.status).toBe('draft');
    expect(kept.statusChangedAt).toBeUndefined();
  });

  it('takes an update’s status and moment from the stored record, not the payload', async () => {
    const w = world({ offerings: [offering('o-1', 'unpublished')] });
    const claimed = offering('o-1', 'published', {
      statusChangedAt: new Date('2030-01-01T00:00:00.000Z'),
    });

    const kept = await w.run(preserveOfferingLifecycle(claimed, 'acme'));

    expect(kept.status).toBe('unpublished');
    expect(kept.statusChangedAt).toEqual(SEEDED_AT);
  });

  it('leaves an update alone when the stored record is gone', async () => {
    const orphan = offering('o-9', 'draft');

    const kept = await world().run(preserveOfferingLifecycle(orphan, 'acme'));

    expect(kept.status).toBe('draft');
  });
});

describe('rebuildPublications', () => {
  it('re-announces each published offering at its own stored moment, never a fresh one', async () => {
    const w = world({
      offerings: [offering('o-1', 'published'), offering('o-2', 'draft')],
    });

    const report = await w.run(
      rebuildPublications({ organizationId: 'acme', source: SOURCE }),
    );

    expect(report.announced).toBe(1);
    expect(w.announced.map(event => event.data.publishedAt)).toEqual([
      SEEDED_AT.toISOString(),
    ]);
  });

  it('counts what the outbox already held, and what it revived', async () => {
    const held = world({
      offerings: [offering('o-1', 'published')],
      reannounce: 'alreadyAnnounced',
    });
    const revived = world({
      offerings: [offering('o-1', 'published')],
      reannounce: 'revived',
    });

    expect(
      (
        await held.run(
          rebuildPublications({ organizationId: 'acme', source: SOURCE }),
        )
      ).alreadyAnnounced,
    ).toBe(1);
    expect(
      (
        await revived.run(
          rebuildPublications({ organizationId: 'acme', source: SOURCE }),
        )
      ).revived,
    ).toBe(1);
  });

  it('skips an offering with no moment, and reports one whose price or specification is gone', async () => {
    const w = world({
      offerings: [
        offering('o-1', 'published', { statusChangedAt: undefined }),
        offering('o-2', 'published'),
        offering('o-3', 'published', { specificationId: 'spec-gone' }),
        offering('o-4', 'published'),
      ],
      priced: ['o-3', 'o-4'],
    });

    const report = await w.run(
      rebuildPublications({ organizationId: 'acme', source: SOURCE }),
    );

    expect(report).toEqual({
      announced: 1,
      revived: 0,
      alreadyAnnounced: 0,
      unannounceable: 2,
      unstamped: 1,
    });
  });

  it('pages rather than reading a whole organization at once', async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      offering(`o-${String(index).padStart(3, '0')}`, 'published'),
    );

    const report = await world({ offerings: many }).run(
      rebuildPublications({ organizationId: 'acme', source: SOURCE }),
    );

    expect(report.announced).toBe(101);
  });
});

describe('rebuildEveryPublication', () => {
  it('walks every organization, and logs one that fails rather than stopping', async () => {
    const w = world({
      offerings: [offering('o-1', 'published')],
      organizations: ['acme', 'globex'],
    });

    await w.run(rebuildEveryPublication(SOURCE));
    await world({ offeringsDown: true }).run(rebuildEveryPublication(SOURCE));

    expect(w.announced).toHaveLength(2);
  });

  it('logs a directory it cannot read, never failing the boot', async () => {
    const failing = Layer.succeed(TenantDirectoryTag, {
      list: () => Effect.fail(new EntifixConnError('cannot list')),
    });

    await expect(
      Effect.runPromise(
        rebuildEveryPublication(SOURCE).pipe(
          Effect.provide(failing),
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EntityRepositoryFactoryTag, {
                for: () => Effect.die('unused'),
              }),
              Layer.succeed(OfferingCatalogTag, {
                commitTransition: () => Effect.die('unused'),
                reannounce: () => Effect.die('unused'),
              }),
            ),
          ),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
