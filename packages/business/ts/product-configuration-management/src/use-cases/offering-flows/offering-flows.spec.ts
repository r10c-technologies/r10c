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
  type VariantSlot,
} from '../../ports/offering-catalog.js';
import { SetStockSourceUC } from '../draw-on-stock/draw-on-stock.uc.js';
import { SetSaleUnitUC } from '../set-sale-unit/set-sale-unit.uc.js';
import { SetVariantUC } from '../set-variant/set-variant.uc.js';
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
  readonly stockWrite?: 'committed' | 'changed';
  readonly variantWrite?: 'committed' | 'changed' | 'taken';
  readonly reannounce?: 'announced' | 'revived' | 'alreadyAnnounced';
  readonly offeringsDown?: boolean;
  readonly organizations?: string[];
}

const world = (stores: Stores = {}) => {
  const committed: { organizationId: string; from: string }[] = [];
  const unitWrites: { revision: number | undefined; saleUnit: string }[] = [];
  const stockWrites: {
    revision: number | undefined;
    stockOfferingId: string | undefined;
    stockFactor: number | undefined;
  }[] = [];
  const variantWrites: {
    revision: number | undefined;
    variantValues: ProductOffering['variantValues'];
    slot: VariantSlot | undefined;
  }[] = [];
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
    setStockSource: (_organizationId, written) =>
      Effect.sync(() => {
        stockWrites.push({
          revision: written.revision,
          stockOfferingId: written.stockOfferingId,
          stockFactor: written.stockFactor,
        });
        return stores.stockWrite ?? 'committed';
      }) as Effect.Effect<'committed' | 'changed'>,
    setVariant: (_organizationId, written, slot) =>
      Effect.sync(() => {
        variantWrites.push({
          revision: written.revision,
          variantValues: written.variantValues,
          slot,
        });
        return stores.variantWrite ?? 'committed';
      }) as Effect.Effect<'committed' | 'changed' | 'taken'>,
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
  return {
    run,
    committed,
    announced,
    offerings,
    unitWrites,
    stockWrites,
    variantWrites,
  };
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

  it('starts a new offering drawing on no base, whatever the body named', async () => {
    const created = Object.assign(new ProductOffering('Box', 'spec-1'), {
      stockOfferingId: 'o-1',
      stockFactor: 12,
    });

    const kept = await world().run(preserveOfferingLifecycle(created, 'acme'));

    expect([kept.stockOfferingId, kept.stockFactor]).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('keeps the stored stock source on an update, whatever the body named', async () => {
    const w = world({
      offerings: [
        offering('o-2', 'draft', { stockOfferingId: 'o-1', stockFactor: 12 }),
      ],
    });
    const claimed = offering('o-2', 'draft', {
      stockOfferingId: 'o-9',
      stockFactor: 1,
    });

    const kept = await w.run(preserveOfferingLifecycle(claimed, 'acme'));

    expect([kept.stockOfferingId, kept.stockFactor]).toEqual(['o-1', 12]);
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

describe('SetSaleUnitUC on a presentation', () => {
  it('keeps a presentation counted', async () => {
    const w = world({
      offerings: [
        offering('o-2', 'draft', { stockOfferingId: 'o-1', stockFactor: 12 }),
      ],
    });

    const error = await w.run(
      Effect.flip(
        SetSaleUnitUC.run({
          organizationId: 'acme',
          id: 'o-2',
          payload: { saleUnit: 'M' },
        }),
      ),
    );

    expect(error).toMatchObject({
      code: 'stockSourceInvalid',
      problem: 'notCounted',
    });
    expect(w.unitWrites).toEqual([]);
  });
});

describe('SetStockSourceUC', () => {
  const base = offering('base', 'published', { saleUnit: 'M' });
  const draw = (
    payload: {
      stockOfferingId?: string;
      stockFactor?: number;
      revision?: number;
    },
    id = 'box',
  ) => SetStockSourceUC.run({ organizationId: 'acme', id, payload });

  it('draws on a base, and answers the new revision', async () => {
    const w = world({
      offerings: [base, offering('box', 'published', { revision: 2 })],
    });

    const set = await w.run(
      draw({ stockOfferingId: 'base', stockFactor: 100_000, revision: 2 }),
    );

    expect([set.stockOfferingId, set.stockFactor, set.revision]).toEqual([
      'base',
      100_000,
      3,
    ]);
    expect(w.stockWrites).toEqual([
      { revision: 2, stockOfferingId: 'base', stockFactor: 100_000 },
    ]);
  });

  it('starts a seeded offering, which has no revision, at revision 1', async () => {
    const w = world({ offerings: [base, offering('box', 'draft')] });

    const set = await w.run(draw({ stockOfferingId: 'base', stockFactor: 12 }));

    expect(set.revision).toBe(1);
  });

  it('stops drawing when it names no base, against the stored revision', async () => {
    const w = world({
      offerings: [
        offering('box', 'draft', {
          stockOfferingId: 'base',
          stockFactor: 12,
          revision: 4,
          saleUnit: 'M',
        }),
      ],
    });

    await w.run(draw({}));

    expect(w.stockWrites).toEqual([
      { revision: 4, stockOfferingId: undefined, stockFactor: undefined },
    ]);
  });

  it.each([
    [
      'notCounted',
      [base, offering('box', 'draft', { saleUnit: 'M' })],
      { stockOfferingId: 'base', stockFactor: 12 },
    ],
    [
      'factor',
      [base, offering('box', 'draft')],
      { stockOfferingId: 'base', stockFactor: 1.5 },
    ],
    ['factor', [base, offering('box', 'draft')], { stockOfferingId: 'base' }],
    ['baseMissing', [base, offering('box', 'draft')], { stockFactor: 12 }],
    [
      'baseMissing',
      [base, offering('box', 'draft')],
      { stockOfferingId: '', stockFactor: 12 },
    ],
    [
      'baseMissing',
      [offering('box', 'draft')],
      { stockOfferingId: 'base', stockFactor: 12 },
    ],
    [
      'self',
      [offering('box', 'draft')],
      { stockOfferingId: 'box', stockFactor: 12 },
    ],
    [
      'baseIsPresentation',
      [
        offering('base', 'draft', { stockOfferingId: 'other', stockFactor: 2 }),
        offering('box', 'draft'),
      ],
      { stockOfferingId: 'base', stockFactor: 12 },
    ],
    [
      'isVariant',
      [
        base,
        offering('box', 'draft', {
          variantValues: [{ axis: 'color', value: 'negro' }],
        }),
      ],
      { stockOfferingId: 'base', stockFactor: 12 },
    ],
    [
      'isBase',
      [
        base,
        offering('box', 'draft'),
        offering('pack', 'draft', { stockOfferingId: 'box', stockFactor: 6 }),
      ],
      { stockOfferingId: 'base', stockFactor: 12 },
    ],
  ] as const)('refuses %s', async (problem, offerings, payload) => {
    const w = world({ offerings: [...offerings] });

    const error = await w.run(Effect.flip(draw(payload)));

    expect(error).toMatchObject({ code: 'stockSourceInvalid', problem });
    expect(w.stockWrites).toEqual([]);
  });

  it('fails a base that cannot be read rather than call it missing', async () => {
    const w = world({ offerings: [offering('box', 'draft')] });
    const get = w.offerings.get.bind(w.offerings);
    w.offerings.get = id =>
      id === 'base' ? Effect.fail(new Unavailable({})) : get(id);

    const error = await w.run(
      Effect.flip(draw({ stockOfferingId: 'base', stockFactor: 12 })),
    );

    expect(error).toBeInstanceOf(Unavailable);
  });

  it('answers a write that lost to a save as changed', async () => {
    const w = world({
      offerings: [base, offering('box', 'draft', { revision: 3 })],
      stockWrite: 'changed',
    });

    const error = await w.run(
      Effect.flip(draw({ stockOfferingId: 'base', stockFactor: 12 })),
    );

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
                setStockSource: () => Effect.die('unused'),
                setVariant: () => Effect.die('unused'),
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

describe('SetVariantUC', () => {
  /** Two versions of one product, `mug`, and another product, `cup`. */
  const specifications = [
    Object.assign(new ProductSpecification(), {
      id: 'spec-1',
      name: 'Mug',
      specKey: 'mug',
      version: 1,
    }),
    Object.assign(new ProductSpecification(), {
      id: 'spec-2',
      name: 'Mug',
      specKey: 'mug',
      version: 2,
    }),
    Object.assign(new ProductSpecification(), {
      id: 'spec-3',
      name: 'Cup',
      specKey: 'cup',
      version: 1,
    }),
    // Predates versioning: its own id is its series.
    Object.assign(new ProductSpecification(), { id: 'spec-old', name: 'Old' }),
  ];
  const black = [{ axis: 'color' as const, value: 'Negro ' }];
  const blue = [{ axis: 'color' as const, value: 'azul' }];
  const variant = (
    variantValues?: readonly { axis: 'color' | 'size'; value: string }[],
    revision?: number,
    id = 'o-1',
  ) =>
    SetVariantUC.run({
      organizationId: 'acme',
      id,
      payload: { variantValues, revision },
    });

  it('records a variant in canonical form, claiming its combination in the series', async () => {
    const w = world({
      specifications,
      offerings: [offering('o-1', 'draft', { revision: 3 })],
    });

    const set = await w.run(variant(black, 3));

    expect(set.variantValues).toEqual([{ axis: 'color', value: 'Negro' }]);
    expect(set.revision).toBe(4);
    expect(w.variantWrites).toEqual([
      {
        revision: 3,
        variantValues: [{ axis: 'color', value: 'Negro' }],
        slot: { series: 'mug', key: 'color=negro' },
      },
    ]);
  });

  it('keys an unversioned product by its own id, and starts a seeded offering at 1', async () => {
    const w = world({
      specifications,
      offerings: [offering('o-1', 'draft', { specificationId: 'spec-old' })],
    });

    const set = await w.run(variant(blue));

    expect(set.revision).toBe(1);
    expect(w.variantWrites[0]?.slot).toEqual({
      series: 'spec-old',
      key: 'color=azul',
    });
  });

  it.each([[[]], [undefined]])(
    'clears a variant with no values (%j), claiming nothing',
    async values => {
      const w = world({
        specifications,
        offerings: [
          offering('o-1', 'draft', { variantValues: black }),
          // A sibling holding an empty list is no variant to agree with.
          offering('o-2', 'draft', { variantValues: [] }),
        ],
      });

      const set = await w.run(variant(values));

      expect(set.variantValues).toBeUndefined();
      expect(w.variantWrites[0]?.slot).toBeUndefined();
    },
  );

  it('ignores a sibling holding an empty list', async () => {
    const w = world({
      specifications,
      offerings: [
        offering('o-1', 'draft'),
        offering('o-2', 'draft', { variantValues: [] }),
      ],
    });

    await w.run(variant([{ axis: 'size', value: '40' }]));

    expect(w.variantWrites).toHaveLength(1);
  });

  it('accepts a sibling on another version of the same product', async () => {
    const w = world({
      specifications,
      offerings: [
        offering('o-1', 'draft'),
        offering('o-2', 'draft', {
          specificationId: 'spec-2',
          variantValues: blue,
        }),
        // Another product's black does not collide.
        offering('o-3', 'draft', {
          specificationId: 'spec-3',
          variantValues: black,
        }),
      ],
    });

    await w.run(variant(black));

    expect(w.variantWrites).toHaveLength(1);
  });

  it.each([
    ['axis', [offering('o-1', 'draft')], [{ axis: 'flavour', value: 'x' }]],
    [
      'presentation',
      [offering('o-1', 'draft', { stockOfferingId: 'b', stockFactor: 2 })],
      black,
    ],
    [
      'axesMismatch',
      [
        offering('o-1', 'draft'),
        offering('o-2', 'draft', { variantValues: blue }),
      ],
      [{ axis: 'size', value: '40' }],
    ],
    [
      'combinationTaken',
      [
        offering('o-1', 'draft'),
        offering('o-2', 'draft', {
          specificationId: 'spec-2',
          variantValues: [{ axis: 'color', value: 'negro' }],
        }),
      ],
      black,
    ],
  ] as const)('refuses %s', async (problem, offerings, values) => {
    const w = world({ specifications, offerings: [...offerings] });

    const failure = await w.run(Effect.flip(variant(values as typeof black)));

    expect(failure).toMatchObject({ code: 'variantInvalid', problem });
    expect(w.variantWrites).toEqual([]);
  });

  it('refuses a combination a concurrent sibling claimed first', async () => {
    const w = world({
      specifications,
      offerings: [offering('o-1', 'draft')],
      variantWrite: 'taken',
    });

    const failure = await w.run(Effect.flip(variant(black)));

    expect(failure).toMatchObject({ problem: 'combinationTaken' });
  });

  it('answers a stale revision as the offering having changed', async () => {
    const w = world({
      specifications,
      offerings: [offering('o-1', 'draft')],
      variantWrite: 'changed',
    });

    const failure = await w.run(Effect.flip(variant(black, 7)));

    expect(failure).toMatchObject({ code: OFFERING_CHANGED });
  });
});

describe('preserveOfferingLifecycle and the variant', () => {
  const specifications = [
    Object.assign(new ProductSpecification(), { id: 'spec-1', specKey: 'mug' }),
    Object.assign(new ProductSpecification(), { id: 'spec-2', specKey: 'mug' }),
    Object.assign(new ProductSpecification(), { id: 'spec-3', specKey: 'cup' }),
  ];
  const stored = offering('o-1', 'draft', {
    variantValues: [{ axis: 'color', value: 'negro' }],
  });

  it('carries the stored variant across a save, whatever the body said', async () => {
    const w = world({ specifications, offerings: [stored] });
    const body = offering('o-1', 'draft', { variantValues: undefined });

    const saved = await w.run(preserveOfferingLifecycle(body, 'acme'));

    // Read through the getters: a composition row is a class instance.
    expect(
      saved.variantValues?.map(({ axis, value }) => ({ axis, value })),
    ).toEqual([{ axis: 'color', value: 'negro' }]);
  });

  it('lets a variant pin another version of its own product', async () => {
    const w = world({ specifications, offerings: [stored] });

    const saved = await w.run(
      preserveOfferingLifecycle(
        offering('o-1', 'draft', { specificationId: 'spec-2' }),
        'acme',
      ),
    );

    expect(saved.specificationId).toBe('spec-2');
  });

  it('refuses moving a variant to another product', async () => {
    const w = world({ specifications, offerings: [stored] });

    const failure = await w.run(
      Effect.flip(
        preserveOfferingLifecycle(
          offering('o-1', 'draft', { specificationId: 'spec-3' }),
          'acme',
        ),
      ),
    );

    expect(failure).toMatchObject({ problem: 'productChanged' });
  });

  it('starts a new offering as no variant', async () => {
    const w = world({ specifications });

    const saved = await w.run(
      preserveOfferingLifecycle(
        offering('o-new', 'draft', {
          variantValues: [{ axis: 'color', value: 'x' }],
        }),
        'acme',
      ),
    );

    expect(saved.variantValues).toBeUndefined();
  });

  it('refuses an offering picture that is not https', async () => {
    const w = world({ specifications });

    const failure = await w.run(
      Effect.flip(
        preserveOfferingLifecycle(
          offering('o-new', 'draft', {
            media: [{ url: 'http://x.test/a.png', alt: 'Taza' }],
          }),
          'acme',
        ),
      ),
    );

    expect(failure).toMatchObject({ code: 'mediaNotHttps' });
  });
});
