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
import type { OfferingStatus } from '../../values/offering-status.js';
import type { OfferingTransition } from '../../values/offering-transition.js';
import {
  ILLEGAL_OFFERING_TRANSITION,
  IllegalOfferingTransition,
  OFFERING_HAS_NO_PRICE,
  OfferingHasNoPrice,
  OfferingPriceRepositoryTag,
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

const run = (
  rows: ProductOffering[],
  id: EntityId,
  transition: OfferingTransition,
  prices: ProductOfferingPrice[] = [price(String(id))],
) => {
  const { repository, saved } = repositoryOf(...rows);
  const { repository: priceRepository, queries } = pricesOf(...prices);

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
    ) as Effect.Effect<
      OfferingTransitionDecision,
      IllegalOfferingTransition | OfferingHasNoPrice,
      never
    >,
  );

  return { exit, saved, queries };
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
    const event = publicationOf(
      run([offering('1', 'published')], '1', 'unpublish').exit,
    );

    expect(Object.keys(event.data).sort()).toEqual([
      'amount',
      'availableHint',
      'currency',
      'name',
      'offeringId',
      'publishedAt',
      'vendorId',
    ]);
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
