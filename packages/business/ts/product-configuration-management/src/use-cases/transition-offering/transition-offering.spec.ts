import {
  CATALOG_PUBLISHED,
  CATALOG_UNPUBLISHED,
  type CatalogPublication,
} from '@r10c/business-ts-catalog-contracts';
import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { DomainEvent, Entity, EntityId } from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
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
  transitionOffering,
  TransitionOfferingInputTag,
} from './transition-offering.js';

/** `EntifixError` is abstract, so a double needs a concrete failure of its own. */
class NotFound extends Error {}

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
        : Effect.fail(new NotFound('not found'));
    },
    load: vi.fn(),
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
  specifications: ProductSpecification[] = [specification(`spec-${String(id)}`)],
) => {
  const { repository, saved } = repositoryOf(...rows);
  const { repository: priceRepository, queries } = pricesOf(...prices);
  const {
    repository: specificationRepository,
    queries: specificationQueries,
  } = specificationsOf(...specifications);

  const exit = Effect.runSyncExit(
    transitionOffering.pipe(
      Effect.provideService(TransitionOfferingInputTag, {
        id,
        transition,
        vendorId: VENDOR,
        source: SOURCE,
        at: AT,
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
      IllegalOfferingTransition | OfferingHasNoPrice | OfferingHasNoSpecification,
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
  return (exit.cause as unknown as { error: TError }).error;
};

const publicationOf = (
  exit: Exit.Exit<OfferingTransitionDecision, unknown>,
): DomainEvent<CatalogPublication> => decisionOf(exit).event;

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
      code: 'product-013',
      description: 'Glazed by hand.',
      brandId: 'product-brand-3',
      categoryId: 'product-category-7',
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
});

describe('the specification the snapshot copies from', () => {
  it('reads it by id, one row, the shape the price is read with', () => {
    // ⚠️ `load` with a filter and never `get`. `makeMongoRepository`'s `get`
    // fails an absent row with `EntifixConnError` — the same class a driver
    // failure raises — so mapping that failure to a `409` would tell every
    // vendor in the fleet their data is broken during a Mongo outage.
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
      run([offering('1', 'published')], '1', 'unpublish', [price('1')], []).exit,
    );

    expect(event.name).toBe(CATALOG_UNPUBLISHED);
    expect(event.data.offeringId).toBe('1');
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
    // `product-specification.routes.ts` registers `PUT` as a plain save with no
    // `prepare` hook, so a body without `code` deserializes to the constructor
    // default. An empty reference on the storefront renders as nothing while
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
});
