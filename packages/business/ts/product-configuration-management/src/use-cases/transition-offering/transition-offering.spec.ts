import { EntityRepositoryTag } from '@entifix/business';
import { type Entity, type EntityId, NotFound } from '@entifix/core';
import {
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  type CatalogEvent,
} from '@r10c/business-ts-catalog-contracts';
import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import { ProductOffering } from '../../entities/product-offering/product-offering.entity.js';
import { ProductOfferingPrice } from '../../entities/product-offering-price/product-offering-price.entity.js';
import { ProductSpecification } from '../../entities/product-specification/product-specification.entity.js';
import type { OfferingStatus } from '../../values/offering-status.js';
import type { OfferingTransition } from '../../values/offering-transition.js';
import {
  ILLEGAL_OFFERING_TRANSITION,
  IllegalOfferingTransition,
  OFFERING_HAS_NO_PRICE,
  OFFERING_HAS_NO_SPECIFICATION,
  OfferingHasNoPrice,
  OfferingHasNoSpecification,
  OfferingPriceRepositoryTag,
  OfferingSpecificationRepositoryTag,
  type OfferingTransitionDecision,
  SPECIFICATION_NOT_ACTIVE,
  SpecificationNotActive,
  transitionOffering,
  TransitionOfferingInputTag,
} from './transition-offering.js';

const AT = new Date('2026-09-07T10:00:00.000Z');
const VENDOR = 'org-1';
const SOURCE = 'marketplace-admin';

const offering = (id: string, status: OfferingStatus): ProductOffering => {
  const one = new ProductOffering(`Offering ${id}`, `spec-${id}`);
  one.id = id;
  one.status = status;
  return one;
};

const price = (offeringId: string, amount = 24_900, currency = 'GTQ') => {
  const one = new ProductOfferingPrice(offeringId, amount, currency);
  one.id = `price-${offeringId}`;
  return one;
};

/**
 * The specification an offering pins. `code`, `description`, `brandId` and
 * `categoryId` are what the storefront renders and what the snapshot has to
 * copy, because the storefront may never read this store.
 */
const specification = (
  id: string,
  overrides: Partial<{
    code: string;
    description: string | undefined;
    brandId: string | undefined;
    categoryId: string | undefined;
    media: ProductSpecification['media'];
    fitsDeviceModelIds: ProductSpecification['fitsDeviceModelIds'];
    lifecycleStatus: ProductSpecification['lifecycleStatus'];
    version: number;
  }> = {},
) => {
  const one = new ProductSpecification(
    overrides.code ?? 'product-013',
    `Specification ${id}`,
  );
  one.id = id;
  one.description =
    'description' in overrides ? overrides.description : 'Glazed by hand.';
  one.brandId = 'brandId' in overrides ? overrides.brandId : 'product-brand-3';
  one.categoryId =
    'categoryId' in overrides ? overrides.categoryId : 'product-category-7';
  one.media = overrides.media;
  one.fitsDeviceModelIds = overrides.fitsDeviceModelIds;
  // A pin may be published only while it is the series' active version.
  one.lifecycleStatus = overrides.lifecycleStatus ?? 'active';
  one.version = overrides.version ?? 1;
  return one;
};

/**
 * A repository holding the rows by id. `save` records what it was handed, so a
 * test can assert nothing was written — which is now the *expected* behaviour
 * on every path, because the transition decides and the route commits.
 */
const repositoryOf = (...rows: ProductOffering[]) => {
  const byId = new Map(rows.map(row => [String(row.id), row]));
  const saved: ProductOffering[] = [];

  const repository = {
    get: <TEntity extends Entity>(id: EntityId) => {
      const row = byId.get(String(id));
      return row
        ? Effect.succeed(row as unknown as TEntity)
        : Effect.fail(new NotFound({ entity: 'offering' }));
    },
    // A presentation's base is loaded by id, a kit's components by `in`.
    load: (request: {
      filtering: { value?: unknown; values?: unknown[] }[];
    }) => {
      const filter = request.filtering[0];
      const items = (filter?.values ?? [filter?.value])
        .map(id => byId.get(String(id)))
        .filter(row => row !== undefined);
      return Effect.succeed({ items, total: items.length });
    },
    save: <TEntity extends Entity>(entity: TEntity) => {
      saved.push(entity as unknown as ProductOffering);
      return Effect.succeed(entity);
    },
    delete: vi.fn(),
  };

  return { repository, saved };
};

/** A price repository answering `load` from a fixed list, recording the query. */
const pricesOf = (...rows: ProductOfferingPrice[]) => {
  const queries: unknown[] = [];
  const repository = {
    get: vi.fn(),
    load: (request: unknown) => {
      queries.push(request);
      return Effect.succeed({ items: rows, total: rows.length });
    },
    save: vi.fn(),
    delete: vi.fn(),
  };
  return { repository, queries };
};

/**
 * A specification repository answering `load` from a fixed list, recording the
 * query — the same double shape as the prices, because both are read the same
 * way and for the same reason.
 */
const specificationsOf = (...rows: ProductSpecification[]) => {
  const queries: unknown[] = [];
  const repository = {
    get: vi.fn(),
    load: (request: unknown) => {
      queries.push(request);
      return Effect.succeed({ items: rows, total: rows.length });
    },
    save: vi.fn(),
    delete: vi.fn(),
  };
  return { repository, queries };
};

const run = (
  rows: ProductOffering[],
  id: EntityId,
  transition: OfferingTransition,
  prices: ProductOfferingPrice[] = [price(String(id))],
  specifications: ProductSpecification[] = [
    specification(`spec-${String(id)}`),
  ],
  restating?: boolean,
) => {
  const { repository, saved } = repositoryOf(...rows);
  const { repository: priceRepository, queries } = pricesOf(...prices);
  const { repository: specificationRepository, queries: specificationQueries } =
    specificationsOf(...specifications);

  const exit = Effect.runSyncExit(
    transitionOffering.pipe(
      Effect.provideService(TransitionOfferingInputTag, {
        id,
        transition,
        vendorId: VENDOR,
        source: SOURCE,
        at: AT,
        restating,
      }),
      // The repository's signature threads a configuration requirement this
      // path never uses; the cast keeps the double honest about the members
      // actually exercised.
      Effect.provideService(
        EntityRepositoryTag,
        repository as unknown as typeof EntityRepositoryTag.Service,
      ),
      Effect.provideService(
        OfferingPriceRepositoryTag,
        priceRepository as unknown as typeof EntityRepositoryTag.Service,
      ),
      Effect.provideService(
        OfferingSpecificationRepositoryTag,
        specificationRepository as unknown as typeof EntityRepositoryTag.Service,
      ),
    ) as Effect.Effect<
      OfferingTransitionDecision,
      | IllegalOfferingTransition
      | OfferingHasNoPrice
      | OfferingHasNoSpecification
      | SpecificationNotActive,
      never
    >,
  );

  return { exit, saved, queries, specificationQueries };
};

const decisionOf = (
  exit: Exit.Exit<OfferingTransitionDecision, unknown>,
): OfferingTransitionDecision => {
  if (!Exit.isSuccess(exit)) throw new Error('expected a decision');
  return exit.value;
};

const failureOf = <TError>(exit: Exit.Exit<unknown, TError>): TError => {
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
};

const publicationOf = (
  exit: Exit.Exit<OfferingTransitionDecision, unknown>,
): CatalogEvent => decisionOf(exit).event;

describe('transitionOffering', () => {
  it('moves a draft to published', () => {
    const { exit } = run([offering('1', 'draft')], '1', 'publish');

    expect(decisionOf(exit).offering.status).toBe('published');
  });

  it('republishes a published offering, because that is how an edit ships', () => {
    const { exit } = run([offering('1', 'published')], '1', 'publish');

    expect(decisionOf(exit).offering.status).toBe('published');
  });

  it('unpublishes a published offering', () => {
    const { exit } = run([offering('1', 'published')], '1', 'unpublish');

    expect(decisionOf(exit).offering.status).toBe('unpublished');
  });

  /**
   * ⚠️ The load-bearing assertion of the whole restructure.
   *
   * The status write and the outbox entry announcing it must be one Mongo
   * transaction (ADR 0028). A `save` here would be the dual write that record
   * exists to forbid: a broker outage between the two leaves the storefront and
   * the vendor's own screen disagreeing permanently, with nothing to replay
   * from. The commit belongs to the caller, which is the only thing holding a
   * session.
   */
  it('saves nothing — the caller commits the record and the event together', () => {
    const { saved } = run([offering('1', 'draft')], '1', 'publish');

    expect(saved).toEqual([]);
  });

  it('refuses to unpublish a draft', () => {
    const { exit } = run([offering('1', 'draft')], '1', 'unpublish');

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('says what it refused, in terms a route can render', () => {
    const { exit } = run([offering('7', 'unpublished')], '7', 'unpublish');
    const failure = failureOf(exit);

    expect(failure).toBeInstanceOf(IllegalOfferingTransition);
    expect((failure as IllegalOfferingTransition).code).toBe(
      ILLEGAL_OFFERING_TRANSITION,
    );
    expect((failure as IllegalOfferingTransition).from).toBe('unpublished');
    expect((failure as IllegalOfferingTransition).transition).toBe('unpublish');
    expect((failure as IllegalOfferingTransition).id).toBe('7');
  });

  it('refuses an illegal move before it reads a price', () => {
    // Ordering matters: an unpublishable draft must be told it is unpublishable,
    // not that it has no price. The second answer sends the vendor to fix
    // something that is not wrong.
    const { exit, queries } = run(
      [offering('1', 'draft')],
      '1',
      'unpublish',
      [],
    );

    expect(failureOf(exit)).toBeInstanceOf(IllegalOfferingTransition);
    expect(queries).toEqual([]);
  });

  it('propagates a record it cannot read', () => {
    const { exit } = run([], 'missing', 'publish');

    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe('the price precondition', () => {
  it('refuses to publish an offering with no price', () => {
    const { exit } = run([offering('1', 'draft')], '1', 'publish', []);
    const failure = failureOf(exit);

    expect(failure).toBeInstanceOf(OfferingHasNoPrice);
    expect((failure as OfferingHasNoPrice).code).toBe(OFFERING_HAS_NO_PRICE);
    expect((failure as OfferingHasNoPrice).id).toBe('1');
  });

  it('leaves the status alone when it refuses', () => {
    // The mutation happens after the check, so a refusal cannot leave a
    // half-moved record for a later save to pick up.
    const record = offering('1', 'draft');

    run([record], '1', 'publish', []);

    expect(record.status).toBe('draft');
  });

  it('asks the store for that offering’s prices and no one else’s', () => {
    const { queries } = run([offering('1', 'draft')], '1', 'publish');

    expect(queries).toEqual([
      {
        filtering: [{ property: 'offeringId', operator: 'eq', value: '1' }],
        pageSize: 1,
      },
    ]);
  });
});

describe('the tiers a price holds', () => {
  const tiered = (tiers: { from: number; amount: number }[]) =>
    Object.assign(price('1'), { tiers });

  it('travel in the publication', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish', [
        tiered([{ from: 10, amount: 22_000 }]),
      ]).exit,
    );

    expect(event.data.tiers).toEqual([{ from: 10, amount: 22_000 }]);
  });

  it('refuse a publication they no longer fit, and leave the status alone', () => {
    const record = offering('1', 'draft');
    // A tier at the minimum is the base price: what a unit reset leaves.
    const { exit } = run([record], '1', 'publish', [
      tiered([{ from: 1, amount: 22_000 }]),
    ]);

    expect(failureOf(exit)).toMatchObject({
      code: 'priceTiersInvalid',
      problem: 'notAscending',
    });
    expect(record.status).toBe('draft');
  });

  it('are announced as published on a takedown, unchecked', () => {
    const event = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish', [
        tiered([{ from: 1, amount: 22_000 }]),
      ]).exit,
    );

    expect(event.data.tiers).toEqual([{ from: 1, amount: 22_000 }]);
  });

  it('are absent, never empty, when the price has none', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish', [tiered([])]).exit,
    );

    expect('tiers' in event.data).toBe(false);
  });
});

describe('a presentation', () => {
  const presentation = (status: OfferingStatus = 'draft') =>
    Object.assign(offering('box', status), {
      stockOfferingId: 'base',
      stockFactor: 100_000,
    });
  const base = (overrides: Partial<ProductOffering> = {}) =>
    Object.assign(offering('base', 'published'), { saleUnit: 'M' }, overrides);

  it('publishes its base, its factor and the base’s unit', () => {
    const event = publicationOf(
      run([base(), presentation()], 'box', 'publish').exit,
    );

    expect(event.data).toMatchObject({
      stockOfferingId: 'base',
      stockFactor: 100_000,
      stockUnit: 'M',
    });
  });

  it('publishes no stock source for an offering that draws on no base', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect('stockOfferingId' in event.data).toBe(false);
  });

  it.each([
    ['baseMissing', () => [presentation()]],
    [
      'baseIsPresentation',
      () => [
        base({ stockOfferingId: 'other', stockFactor: 2 }),
        presentation(),
      ],
    ],
    [
      'notCounted',
      () => [base(), Object.assign(presentation(), { saleUnit: 'M' })],
    ],
    [
      'factor',
      () => [base(), Object.assign(presentation(), { stockFactor: 0 })],
    ],
  ] as const)('refuses a publication whose source is %s', (problem, rows) => {
    const records = rows();
    const { exit } = run([...records], 'box', 'publish');

    expect(failureOf(exit)).toMatchObject({
      code: 'stockSourceInvalid',
      problem,
    });
    expect(records.at(-1)?.status).toBe('draft');
  });

  it('takes a presentation down without its base, naming none', () => {
    const event = publicationOf(
      run([presentation('published')], 'box', 'unpublish').exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
    expect('stockOfferingId' in event.data).toBe(false);
  });
});

describe('what a transition announces', () => {
  it('names a publication for a move to published', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(event.name).toBe(CATALOG_PUBLISHED);
  });

  it('names an unpublication for a move away from it', () => {
    const event = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish').exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
  });

  it('carries the snapshot the projection is written from', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(event.data).toEqual({
      offeringId: '1',
      vendorId: VENDOR,
      name: 'Offering 1',
      amount: 24_900,
      currency: 'GTQ',
      availableHint: true,
      publishedAt: AT.toISOString(),
      specificationId: 'spec-1',
      specificationVersion: 1,
      saleUnit: 'UN',
      quantityStep: 1,
      quantityMinimum: 1,
      pricePer: 1,
      code: 'product-013',
      description: 'Glazed by hand.',
      brandId: 'product-brand-3',
      categoryId: 'product-category-7',
      // A specification from before versioning is its own series.
      specKey: 'spec-1',
    });
  });

  it('carries the variant and the offering’s own pictures over the specification’s', () => {
    const variant = Object.assign(offering('1', 'draft'), {
      variantValues: [
        { axis: 'size', value: '40' },
        { axis: 'color', value: 'café' },
      ],
      media: [{ url: 'https://media.test/cafe.png', alt: 'Suela café' }],
    });

    const event = publicationOf(run([variant], '1', 'publish').exit);

    expect(event.data).toMatchObject({
      variantValues: [
        { axis: 'color', value: 'café' },
        { axis: 'size', value: '40' },
      ],
      media: [{ url: 'https://media.test/cafe.png', alt: 'Suela café' }],
    });
  });

  it('copies what the price buys and how a buyer may ask for it', () => {
    const measured = Object.assign(offering('1', 'draft'), {
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
    });
    const perHundred = Object.assign(price('1', 750), { pricePer: 100 });

    const event = publicationOf(
      run([measured], '1', 'publish', [perHundred]).exit,
    );

    expect(event.data).toMatchObject({
      amount: 750,
      saleUnit: 'M',
      quantityStep: 500,
      quantityMinimum: 1000,
      pricePer: 100,
    });
  });

  it('takes the vendor from the input, never from the record', () => {
    // `ProductOffering` has no `organizationId` — entities are
    // organization-agnostic and isolation is which database handle the request
    // resolved to. So the vendor can only come from the verified principal.
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(event.data.vendorId).toBe(VENDOR);
  });

  it('copies the price rather than pointing at it', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish', [price('1', 999, 'USD')])
        .exit,
    );

    expect(event.data.amount).toBe(999);
    expect(event.data.currency).toBe('USD');
  });

  it('signs the message with the emitting slice it was handed', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(event.source).toBe(SOURCE);
  });

  it('gives an unpublication the same shape as a publication', () => {
    // The consumer's ordering guard reads `publishedAt` off both. A payload
    // that changed shape by event name would be two decoders and two ways to
    // skip that guard.
    //
    // Asserted as the two key sets *agreeing*, not against a written-out list:
    // an optional member is present or absent according to the data, so a fixed
    // list would pin the fixture rather than the property, and would go stale
    // the first time a member joined the snapshot.
    const published = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );
    const unpublished = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish').exit,
    );

    expect(Object.keys(unpublished.data).sort()).toEqual(
      Object.keys(published.data).sort(),
    );
  });

  it('hints availability until something can compute it', () => {
    // Nothing computes availability yet — the `stock` slice is `planned`. The
    // badge is a hint and the reservation is the truth, so publishing
    // everything as unavailable would make the hint say nothing.
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(event.data.availableHint).toBe(true);
  });

  it('announces the moment it was given, not one it read from a clock', () => {
    const decision = decisionOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(decision.event.at).toBe(AT.toISOString());
    expect(decision.event.data.publishedAt).toBe(AT.toISOString());
  });

  /**
   * ⚠️ The moment is **stored**, not only announced, and that is what makes a
   * fleet-wide rebuild possible at all.
   *
   * The announcement's id is `<offeringId>:<publishedAt>`, and the projection
   * orders on the same value. A walk that re-emitted with `now` would therefore
   * mint a new publication rather than redeliver one, overwrite the ordering key,
   * and let an older publication overtake a genuine takedown.
   */
  it('stamps the offering with the moment it announces', () => {
    const decision = decisionOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect(decision.offering.statusChangedAt).toBe(AT);
    expect(decision.offering.statusChangedAt?.toISOString()).toBe(
      decision.event.data.publishedAt,
    );
  });

  it('stamps a takedown too, so the pair never disagrees', () => {
    // The payload's `publishedAt` already carries a takedown's moment; storing
    // it under the honest name is what keeps `statusChangedAt` readable on an
    // `unpublished` record.
    const decision = decisionOf(
      run([offering('1', 'published')], '1', 'unpublish').exit,
    );

    expect(decision.offering.status).toBe('unpublished');
    expect(decision.offering.statusChangedAt).toBe(AT);
  });
});

describe('the specification the snapshot copies from', () => {
  it('reads it by id, one row, the shape the price is read with', () => {
    // `load` with a filter and never `get`: the one read shape the price is
    // read with too, so an absent specification is an empty page rather than a
    // `NotFound` about a record the caller never addressed.
    const { specificationQueries } = run(
      [offering('1', 'draft')],
      '1',
      'publish',
    );

    expect(specificationQueries).toEqual([
      {
        filtering: [{ property: 'id', operator: 'eq', value: 'spec-1' }],
        pageSize: 1,
      },
    ]);
  });

  it('refuses a publication whose specification is gone', () => {
    // Nothing enforces `specificationId`. Publishing anyway projects a card
    // with a name and a price and no description, brand or category, which
    // reads to the vendor as a rendering bug rather than as data they own.
    const failure = failureOf(
      run([offering('1', 'draft')], '1', 'publish', [price('1')], []).exit,
    );

    expect(failure).toBeInstanceOf(OfferingHasNoSpecification);
    expect(failure.code).toBe(OFFERING_HAS_NO_SPECIFICATION);
  });

  it('names the id that dangles, because the offering screen cannot', () => {
    const failure = failureOf(
      run([offering('1', 'draft')], '1', 'publish', [price('1')], []).exit,
    ) as OfferingHasNoSpecification;

    expect(failure.specificationId).toBe('spec-1');
  });

  it('lets an unpublication through when the specification is gone', () => {
    // ⚠️ The divergence from the price precondition, and it is deliberate.
    // Refusing a *takedown* because the record it describes is broken leaves a
    // vendor unable to remove a live listing, with repairing tenant data as the
    // only remedy. ADR 0048 accepted that residual once; this does not repeat
    // it.
    const event = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish', [price('1')], [])
        .exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
    expect(event.data.offeringId).toBe('1');
  });

  it('refuses a publication pinned to a version still in design', () => {
    // ADR 0079 §2: a draft would sell content its author has not frozen.
    const failure = failureOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { lifecycleStatus: 'in-design' })],
      ).exit,
    ) as SpecificationNotActive;

    expect(failure).toBeInstanceOf(SpecificationNotActive);
    expect(failure.code).toBe(SPECIFICATION_NOT_ACTIVE);
    expect(failure.standing).toBe('in-design');
    expect(failure.specificationId).toBe('spec-1');
  });

  it('refuses a republication pinned to a retired version', () => {
    // Moving an offering onto the new version is the vendor's act; until
    // then a republication would put a withdrawn version back on sale.
    const failure = failureOf(
      run(
        [offering('1', 'published')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { lifecycleStatus: 'retired' })],
      ).exit,
    );

    expect(failure).toBeInstanceOf(SpecificationNotActive);
  });

  it('restates a publication whose pin was retired since', () => {
    // The rebuild walk restates what already went on sale: an offering on
    // version 1 stays on sale after version 2 is released (ADR 0079 §2).
    const event = publicationOf(
      run(
        [offering('1', 'published')],
        '1',
        'publish',
        [price('1')],
        [
          specification('spec-1', {
            lifecycleStatus: 'retired',
            version: 3,
          }),
        ],
        true,
      ).exit,
    );

    expect(event.data.specificationVersion).toBe(3);
  });

  it('takes an offering down whatever its pin stands at', () => {
    const event = publicationOf(
      run(
        [offering('1', 'published')],
        '1',
        'unpublish',
        [price('1')],
        [specification('spec-1', { lifecycleStatus: 'in-design' })],
      ).exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
  });

  it('announces the pin a takedown names when its specification is gone', () => {
    // One payload shape by event name: the id the offering names, version 0.
    const event = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish', [price('1')], [])
        .exit,
    );

    expect(event.data.specificationId).toBe('spec-1');
    expect(event.data.specificationVersion).toBe(0);
  });

  it('is read before the price, so the first refusal is the deeper one', () => {
    // An offering naming nothing describes no product at all. Telling its
    // vendor to add a price points them at the wrong screen.
    const failure = failureOf(
      run([offering('1', 'draft')], '1', 'publish', [], []).exit,
    );

    expect(failure).toBeInstanceOf(OfferingHasNoSpecification);
  });

  it('is not read at all when the move itself is illegal', () => {
    const { specificationQueries } = run(
      [offering('1', 'draft')],
      '1',
      'unpublish',
    );

    expect(specificationQueries).toEqual([]);
  });

  it('publishes a specification carrying none of the optional members', () => {
    // ⚠️ The anti-poison case. A rejected payload is quarantined with zero
    // retries, so a description nobody wrote must not be able to stop a
    // publication.
    const event = publicationOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [
          specification('spec-1', {
            description: undefined,
            brandId: undefined,
            categoryId: undefined,
          }),
        ],
      ).exit,
    );

    expect(event.data.description).toBeUndefined();
    expect(event.data.brandId).toBeUndefined();
    expect(event.data.categoryId).toBeUndefined();
    expect(event.data.code).toBe('product-013');
  });

  it('omits an absent member rather than announcing it as undefined', () => {
    // ⚠️ The distinction survives further than it looks: the event is written
    // to the outbox before it is published, and BSON stores an assigned
    // `undefined` as `null`. Not writing it is the half that does not depend on
    // the consumer's decoder being careful.
    const event = publicationOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { description: undefined })],
      ).exit,
    );

    expect(Object.keys(event.data)).not.toContain('description');
  });

  it('drops a blank code, which is what a PUT that omits it leaves behind', () => {
    // `product-specification.routes.ts` registers `PUT` as a plain save whose
    // `prepare` only checks media, so a body without `code` deserializes to the
    // constructor default. An empty reference on the storefront renders as nothing while
    // claiming to be one.
    const event = publicationOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { code: '' })],
      ).exit,
    );

    expect(Object.keys(event.data)).not.toContain('code');
  });

  it("copies the pictures, in the vendor's order, as plain values", () => {
    const media = [
      { url: 'https://cdn.example/front.jpg', alt: 'Front' },
      { url: 'https://cdn.example/back.jpg', alt: 'Back' },
    ];
    const event = publicationOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { media })],
      ).exit,
    );

    expect(event.data.media).toEqual(media);
  });

  it('omits an empty gallery rather than announcing []', () => {
    // An empty gallery is a slot that claims to hold something (ADR 0049).
    const event = publicationOf(
      run(
        [offering('1', 'draft')],
        '1',
        'publish',
        [price('1')],
        [specification('spec-1', { media: [] })],
      ).exit,
    );

    expect(Object.keys(event.data)).not.toContain('media');
  });

  it('copies the phones the specification fits, and omits none as absent', () => {
    const publish = (fitsDeviceModelIds: string[] | undefined) =>
      publicationOf(
        run(
          [offering('1', 'draft')],
          '1',
          'publish',
          [price('1')],
          [specification('spec-1', { fitsDeviceModelIds })],
        ).exit,
      ).data;

    expect(publish(['universal']).fitsDeviceModelIds).toEqual(['universal']);
    expect(Object.keys(publish([]))).not.toContain('fitsDeviceModelIds');
  });
});

describe('a kit', () => {
  const kit = (status: OfferingStatus = 'draft') =>
    Object.assign(offering('kit', status), {
      kitComponents: [
        { offeringId: 'case', quantity: 1 },
        { offeringId: 'roll', quantity: 2 },
      ],
      kitSize: 2,
    });
  const kase = (overrides: Partial<ProductOffering> = {}) =>
    Object.assign(offering('case', 'published'), overrides);
  const roll = () =>
    Object.assign(offering('roll', 'published'), {
      stockOfferingId: 'cable',
      stockFactor: 100_000,
    });
  const cable = () =>
    Object.assign(offering('cable', 'published'), { saleUnit: 'M' });

  it('publishes what one kit takes from each component, a presentation from its base', () => {
    const event = publicationOf(
      run([kase(), roll(), cable(), kit()], 'kit', 'publish').exit,
    );

    expect(event.data).toMatchObject({
      kitComponents: [
        {
          offeringId: 'case',
          quantity: 1,
          stockOfferingId: 'case',
          stockUnit: 'UN',
          stockQuantity: 1,
        },
        {
          offeringId: 'roll',
          quantity: 2,
          stockOfferingId: 'cable',
          stockUnit: 'M',
          stockQuantity: 200_000,
        },
      ],
    });
    expect('stockOfferingId' in event.data).toBe(false);
  });

  it('publishes no components for an offering that is not a kit', () => {
    const event = publicationOf(
      run([offering('1', 'draft')], '1', 'publish').exit,
    );

    expect('kitComponents' in event.data).toBe(false);
  });

  it.each([
    ['componentMissing', () => [roll(), cable(), kit()]],
    ['componentMissing', () => [kase(), roll(), kit()]],
    [
      'componentIsKit',
      () => [kase({ kitSize: 1, kitComponents: [] }), roll(), cable(), kit()],
    ],
    [
      'componentNotCounted',
      () => [kase({ saleUnit: 'M' }), roll(), cable(), kit()],
    ],
    [
      'componentUnpublished',
      () => [kase({ status: 'draft' }), roll(), cable(), kit()],
    ],
    [
      'notCounted',
      () => [kase(), roll(), cable(), Object.assign(kit(), { saleUnit: 'M' })],
    ],
    [
      'duplicate',
      () => [
        kase(),
        Object.assign(kit(), {
          kitComponents: [
            { offeringId: 'case', quantity: 1 },
            { offeringId: 'case', quantity: 1 },
          ],
        }),
      ],
    ],
  ] as const)('refuses a publication whose kit is %s', (problem, rows) => {
    const records = rows();
    const { exit } = run([...records], 'kit', 'publish');

    expect(failureOf(exit)).toMatchObject({ code: 'kitInvalid', problem });
    expect(records.at(-1)?.status).toBe('draft');
  });

  it('takes a kit down without its components, naming none', () => {
    const event = publicationOf(
      run([kit('published')], 'kit', 'unpublish').exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
    expect('kitComponents' in event.data).toBe(false);
  });
});
