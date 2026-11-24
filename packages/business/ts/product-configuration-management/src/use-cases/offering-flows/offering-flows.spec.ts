import {
  EntityRepositoryFactoryTag,
  TenantDirectoryTag,
} from '@entifix/business';
import { Unavailable } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductOfferingPrice } from '../../entities/product-offering-price/product-offering-price.entity.js';
import { ProductSpecification } from '../../entities/product-specification/product-specification.entity.js';
import {
  type OfferingCatalog,
  OfferingCatalogTag,
} from '../../ports/offering-catalog.js';
import { SetSaleUnitUC } from '../set-sale-unit/set-sale-unit.uc.js';
import {
  OFFERING_CHANGED,
  preparePrice,
  preserveOfferingLifecycle,
  rebuildEveryPublication,
  rebuildPublications,
  refuseUnknownPricePer,
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
  Object.assign(new ProductSpecification(), {
    id: 'spec-1',
    name: 'A widget',
    version: 1,
    lifecycleStatus: 'active',
  });

interface Stores {
  readonly offerings?: ProductOffering[];
  readonly priced?: string[];
  readonly tiers?: { from: number; amount: number }[];
  readonly specifications?: ProductSpecification[];
  readonly commit?: 'committed' | 'changed';
  readonly unitWrite?: 'committed' | 'changed';
  readonly reannounce?: 'announced' | 'revived' | 'alreadyAnnounced';
  readonly offeringsDown?: boolean;
  readonly organizations?: string[];
}

const world = (stores: Stores = {}) => {
  const committed: { organizationId: string; from: string }[] = [];
  const unitWrites: { revision: number | undefined; saleUnit: string }[] = [];
  const announced: CatalogEvent[] = [];
  const offerings = makeInMemoryEntityRepository(stores.offerings ?? []);
  const prices = makeInMemoryEntityRepository(
    (stores.priced ?? (stores.offerings ?? []).map(one => String(one.id))).map(
      id => Object.assign(priceFor(id), { tiers: stores.tiers }),
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
      }) as Effect.Effect<'committed' | 'changed'>,
    setSaleUnit: (_organizationId, written) =>
      Effect.sync(() => {
        unitWrites.push({
          revision: written.revision,
          saleUnit: written.saleUnit,
        });
        return stores.unitWrite ?? 'committed';
      }) as Effect.Effect<'committed' | 'changed'>,
    setPriceTiers: () => Effect.die('unused'),
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
            ? Effect.fail(new Unavailable({}))
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
  return { run, committed, announced, offerings, unitWrites };
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

  it('answers the revision the write moved to, so a reload saves against it', async () => {
    const w = world({ offerings: [offering('o-1', 'draft', { revision: 4 })] });

    const published = await w.run(
      transitionOfferingFor({
        organizationId: 'acme',
        id: 'o-1',
        transition: 'publish',
        source: SOURCE,
      }),
    );

    expect(published.revision).toBe(5);
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

  it('transitions every matching row but the excluded ones, and names a failure by its code', async () => {
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
    expect(down).toEqual([{ id: 'o-9', ok: false, code: 'unavailable' }]);
  });

  it('refuses a selection past the cap whole, before any row moves', async () => {
    const ids = new Set(
      Array.from({ length: 501 }, (_unused, index) => `o-${String(index)}`),
    );

    const refused = await world({}).run(
      Effect.flip(
        transitionOfferingSelection({
          organizationId: 'acme',
          selection: { mode: 'ids', ids },
          transition: 'publish',
          source: SOURCE,
        }),
      ),
    );

    expect(refused).toMatchObject({ code: 'selectionTooLarge', max: 500 });
  });

  it('refuses a matching selection one row past the cap', async () => {
    const offerings = Array.from({ length: 501 }, (_unused, index) =>
      offering(`o-${String(index)}`, 'draft'),
    );

    const refused = await world({ offerings }).run(
      Effect.flip(
        transitionOfferingSelection({
          organizationId: 'acme',
          selection: { mode: 'matching', total: 501, excluded: new Set() },
          transition: 'publish',
          source: SOURCE,
        }),
      ),
    );

    expect(refused).toMatchObject({ code: 'selectionTooLarge' });
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

  it('sells a new offering one by one, whatever unit the body named', async () => {
    const created = Object.assign(new ProductOffering('Cable', 'spec-1'), {
      saleUnit: 'M' as const,
    });

    const kept = await world().run(preserveOfferingLifecycle(created, 'acme'));

    expect(kept.saleUnit).toBe('UN');
  });

  it('keeps the stored unit on an update, and the step it was given', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft', { saleUnit: 'M' })],
    });
    const claimed = offering('o-1', 'draft', {
      saleUnit: 'UN',
      quantityStep: 500,
      quantityMinimum: 1000,
    });

    const kept = await w.run(preserveOfferingLifecycle(claimed, 'acme'));

    expect([kept.saleUnit, kept.quantityStep, kept.quantityMinimum]).toEqual([
      'M',
      500,
      1000,
    ]);
  });

  it('refuses a step and minimum that sell nothing', async () => {
    const claimed = offering('o-9', 'draft', {
      quantityStep: 2,
      quantityMinimum: 3,
    });

    const error = await world().run(
      Effect.flip(preserveOfferingLifecycle(claimed, 'acme')),
    );

    expect(error).toMatchObject({
      code: 'saleRuleInvalid',
      saleUnit: 'UN',
      quantityStep: 2,
      quantityMinimum: 3,
    });
    expect(error.message).toContain('a step of 2 from 3');
  });
});

describe('refuseUnknownPricePer', () => {
  it.each([1, 100, 1000] as const)('keeps a price for %i', async pricePer => {
    const price = Object.assign(priceFor('o-1'), { pricePer });

    expect(await Effect.runPromise(refuseUnknownPricePer(price))).toBe(price);
  });

  it('refuses a price for any other quantity', async () => {
    const price = Object.assign(priceFor('o-1'), { pricePer: 12 });

    const error = await Effect.runPromise(
      Effect.flip(refuseUnknownPricePer(price as ProductOfferingPrice)),
    );

    expect(error).toMatchObject({ code: 'pricePerInvalid', pricePer: 12 });
    expect(error.message).toContain('not 12');
  });
});

describe('preparePrice', () => {
  const saving = (amount: number, id?: string) =>
    Object.assign(new ProductOfferingPrice('o-1', amount, 'GTQ'), {
      id,
      // What a body may say; the stored tiers win.
      tiers: [{ from: 3, amount: 1 }],
    });

  it('starts a new price with no tiers, whatever the body said', async () => {
    const w = world({ offerings: [offering('o-1', 'draft')] });

    const prepared = await w.run(preparePrice(saving(1999), 'acme'));

    expect(prepared.tiers).toBeUndefined();
  });

  it('carries the stored tiers across a save', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft')],
      tiers: [{ from: 10, amount: 1800 }],
    });

    const prepared = await w.run(
      preparePrice(saving(2100, 'price-o-1'), 'acme'),
    );

    expect(
      prepared.tiers?.map(({ from, amount }) => ({ from, amount })),
    ).toEqual([{ from: 10, amount: 1800 }]);
  });

  it('refuses a base price lowered to a tier', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft')],
      tiers: [{ from: 10, amount: 1800 }],
    });

    const error = await w.run(
      Effect.flip(preparePrice(saving(1800, 'price-o-1'), 'acme')),
    );

    expect(error).toMatchObject({
      code: 'priceTiersInvalid',
      problem: 'notCheaper',
    });
  });

  it('keeps a stored price with no tiers as it is', async () => {
    const w = world({ offerings: [offering('o-1', 'draft')] });

    const prepared = await w.run(
      preparePrice(saving(2100, 'price-o-1'), 'acme'),
    );

    expect(prepared.tiers).toBeUndefined();
  });

  it('starts a price whose id is not stored as new', async () => {
    const w = world({ offerings: [offering('o-1', 'draft')] });

    const prepared = await w.run(preparePrice(saving(2100, 'absent'), 'acme'));

    expect(prepared.tiers).toBeUndefined();
  });

  it('refuses an unknown pricePer before reading anything', async () => {
    const w = world({ offerings: [offering('o-1', 'draft')] });

    const error = await w.run(
      Effect.flip(
        preparePrice(
          Object.assign(saving(2100), { pricePer: 12 }) as ProductOfferingPrice,
          'acme',
        ),
      ),
    );

    expect(error).toMatchObject({ code: 'pricePerInvalid' });
  });
});

describe('SetSaleUnitUC', () => {
  const setUnit = (revision?: number) =>
    SetSaleUnitUC.run({
      organizationId: 'acme',
      id: 'o-1',
      payload: { saleUnit: 'M', revision },
    });

  it('sets the unit, resets step and minimum to one of it, and answers the new revision', async () => {
    const w = world({ offerings: [offering('o-1', 'draft', { revision: 3 })] });

    const set = await w.run(setUnit(3));

    expect([set.saleUnit, set.quantityStep, set.quantityMinimum]).toEqual([
      'M',
      1000,
      1000,
    ]);
    expect(set.revision).toBe(4);
    expect(w.unitWrites).toEqual([{ revision: 3, saleUnit: 'M' }]);
  });

  it('writes against the stored revision when the caller named none', async () => {
    const w = world({ offerings: [offering('o-1', 'draft', { revision: 3 })] });

    await w.run(setUnit());

    expect(w.unitWrites.map(one => one.revision)).toEqual([3]);
  });

  it('starts a seeded offering, which has no revision, at revision 1', async () => {
    const w = world({ offerings: [offering('o-1', 'pending-review')] });

    expect((await w.run(setUnit())).revision).toBe(1);
  });

  it.each(['published', 'unpublished'] as const)(
    'refuses an offering that is %s: its unit is fixed',
    async status => {
      const w = world({ offerings: [offering('o-1', status)] });

      const error = await w.run(Effect.flip(setUnit()));

      expect(error).toMatchObject({ code: 'saleUnitFixed', id: 'o-1' });
      expect(error.message).toContain('create another offering');
      expect(w.unitWrites).toEqual([]);
    },
  );

  it('answers a write that lost to a save or a publish as changed', async () => {
    const w = world({
      offerings: [offering('o-1', 'draft', { revision: 3 })],
      unitWrite: 'changed',
    });

    const error = await w.run(Effect.flip(setUnit(2)));

    expect((error as { code?: string }).code).toBe(OFFERING_CHANGED);
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
  it('walks every organization, and reports one that fails rather than stopping', async () => {
    const w = world({
      offerings: [offering('o-1', 'published')],
      organizations: ['acme', 'globex'],
    });

    const walked = await w.run(rebuildEveryPublication(SOURCE));
    const down = await world({ offeringsDown: true }).run(
      rebuildEveryPublication(SOURCE),
    );

    expect(w.announced).toHaveLength(2);
    expect(walked.rebuilt.map(entry => entry.organizationId)).toEqual([
      'acme',
      'globex',
    ]);
    expect(walked.failed).toEqual([]);
    expect(down.rebuilt).toEqual([]);
    expect(down.failed).toEqual([
      { organizationId: 'acme', failure: expect.any(Unavailable) },
    ]);
  });

  it('fails on a directory it cannot read, for the shell to log', async () => {
    const failing = Layer.succeed(TenantDirectoryTag, {
      list: () => Effect.fail(new Unavailable({})),
    });

    const failure = await Effect.runPromise(
      Effect.flip(
        rebuildEveryPublication(SOURCE).pipe(
          Effect.provide(failing),
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(EntityRepositoryFactoryTag, {
                for: () => Effect.die('unused'),
              }),
              Layer.succeed(OfferingCatalogTag, {
                commitTransition: () => Effect.die('unused'),
                setSaleUnit: () => Effect.die('unused'),
                setPriceTiers: () => Effect.die('unused'),
                reannounce: () => Effect.die('unused'),
              }),
            ),
          ),
        ),
      ),
    );

    expect(failure).toBeInstanceOf(Unavailable);
  });
});
