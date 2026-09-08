import {
  type CatalogPublication,
  catalogPublishedEvent,
  catalogUnpublishedEvent,
} from '@r10c/business-ts-catalog-contracts';
import { EntityRepositoryTag } from '@r10c/entifix-ts-business';
import type { DomainEvent, EntityId } from '@r10c/entifix-ts-core';
import { Context, Data, Effect } from 'effect';

import type { ProductOffering } from '../../entities/product-offering';
import type { ProductOfferingPrice } from '../../entities/product-offering-price';
import type { ProductSpecification } from '../../entities/product-specification';
import {
  offeringStatusAfter,
  type OfferingTransition,
} from '../../values/offering-transition';

/** Which offering to move, which way, and on whose behalf. */
export interface TransitionOfferingInput {
  readonly id: EntityId;
  readonly transition: OfferingTransition;
  /**
   * The organization whose catalog this is — the published record's `vendorId`.
   *
   * It comes from the **verified principal** at the route, never from a request
   * body. The same rule as `entity.id = params.id`: this member decides which
   * vendor a storefront row is attributed to, and once orders exist, who is
   * paid for it.
   */
  readonly vendorId: string;
  /**
   * The emitting slice, for the message's `source`.
   *
   * Passed in rather than read from `EventSourceTag`, which lives in
   * `entifix-ts-transactions`: this package would gain a dependency on the
   * transaction machinery to spell one string, and a domain use case has no
   * business knowing a bus exists. The route holds the tag and hands the value
   * down — the same shape as the repositories above it.
   */
  readonly source: string;
  /**
   * When the move was decided. Injected so the announced moment and the stored
   * one are the same value, and so a test can pin it.
   */
  readonly at: Date;
}

export class TransitionOfferingInputTag extends Context.Tag(
  'TransitionOfferingInputTag',
)<TransitionOfferingInputTag, TransitionOfferingInput>() {}

/**
 * The offering's prices, as a second repository.
 *
 * A separate tag rather than a second use of `EntityRepositoryTag`, because one
 * tag resolves to one value: providing `EntityRepositoryTag` twice in the same
 * effect gives both reads whichever was provided last, and a repository built
 * for `ProductOffering` answering a price query returns documents that
 * deserialize into the wrong class rather than failing.
 */
export class OfferingPriceRepositoryTag extends Context.Tag(
  'OfferingPriceRepositoryTag',
)<OfferingPriceRepositoryTag, EntityRepositoryTag['Type']>() {}

/**
 * The offering's pinned specification, as a third repository — a separate tag
 * for the same reason the prices are.
 *
 * It exists because the storefront cannot read tenant storage: the merchandising
 * fields a card and a product page render live on `ProductSpecification`, so the
 * snapshot has to copy them at publication or they never reach the platform
 * plane at all (ADR 0009).
 */
export class OfferingSpecificationRepositoryTag extends Context.Tag(
  'OfferingSpecificationRepositoryTag',
)<OfferingSpecificationRepositoryTag, EntityRepositoryTag['Type']>() {}

/**
 * The code a route renders when the move is not allowed.
 *
 * A **code, not a sentence**: the browser resolves it through the shared
 * `errors` catalog and `@r10c/i18n-check` fails the build on one the catalog
 * lacks. Neither types nor locale parity can see a missing code — the render
 * path casts the typed-key gate away, and a code absent from both locales is
 * symmetric — so that check is the only thing looking.
 */
export const ILLEGAL_OFFERING_TRANSITION = 'illegalOfferingTransition';

/** The code a route renders when there is nothing to charge for the offering. */
export const OFFERING_HAS_NO_PRICE = 'offeringHasNoPrice';

/** The code a route renders when the offering names a specification that is gone. */
export const OFFERING_HAS_NO_SPECIFICATION = 'offeringHasNoSpecification';

/** An offering that cannot make the move that was asked of it. */
export class IllegalOfferingTransition extends Data.TaggedError(
  'IllegalOfferingTransition',
)<{
  readonly id: EntityId;
  readonly from: string;
  readonly transition: OfferingTransition;
}> {
  readonly code = ILLEGAL_OFFERING_TRANSITION;
}

/**
 * An offering asked to reach the storefront with no `ProductOfferingPrice`.
 *
 * ADR 0047 recorded this precondition as deliberately absent and said the
 * honest place for it is "the commit that makes the projection depend on it".
 * That commit is this one. `CatalogPublication` carries `amount` and `currency`,
 * so publishing without a price would either project a `0` the vendor never
 * authored — indistinguishable from free at checkout — or emit a payload the
 * consumer must silently drop, which is a `200` for the vendor and a listing
 * that never appears, with the only evidence in another service's log.
 */
export class OfferingHasNoPrice extends Data.TaggedError('OfferingHasNoPrice')<{
  readonly id: EntityId;
}> {
  readonly code = OFFERING_HAS_NO_PRICE;
}

/**
 * An offering asked to reach the storefront while naming a specification that
 * no longer exists.
 *
 * Nothing enforces `specificationId` — it is a plain id, and deleting the
 * specification leaves the offering behind. Publishing anyway would project a
 * record with no description, no brand and no category: a card that renders as
 * a name and a price, which reads to the vendor as a rendering bug rather than
 * as missing data they own.
 *
 * ⚠️ **It refuses a publication and never a takedown.** The lookup runs on both
 * transitions, because the announced payload must not change shape by event
 * name — but refusing an *unpublish* because the record it describes is broken
 * would leave a vendor unable to remove a live listing, with repairing tenant
 * data as the only remedy. ADR 0048 accepted exactly that residual for the price
 * precondition; repeating it here would compound it. `specificationId` rides on
 * the failure so the operator knows which id dangles.
 */
export class OfferingHasNoSpecification extends Data.TaggedError(
  'OfferingHasNoSpecification',
)<{
  readonly id: EntityId;
  readonly specificationId: string;
}> {
  readonly code = OFFERING_HAS_NO_SPECIFICATION;
}

/** The members the snapshot copies off the pinned specification. */
const MERCHANDISING = ['code', 'description', 'brandId', 'categoryId'] as const;

/**
 * The merchandising half of the snapshot, with every absent member **absent**
 * rather than `undefined`.
 *
 * ⚠️ That distinction survives further than it looks. The event is written to
 * the outbox before it is published, `MongoClientLayer` does not set
 * `ignoreUndefined`, and BSON writes `undefined` as `null` — so a member
 * assigned `undefined` here reaches the consumer's decoder as `null` after the
 * round trip. `optionalString` tolerates that on the reading side; not writing
 * it is the half that does not depend on the reader being careful.
 *
 * `''` is dropped with `undefined`: a `PUT` omitting `code` blanks it, and an
 * empty string on the storefront is a label that renders as nothing while
 * claiming to be a reference.
 */
const merchandisingOf = (
  specification: ProductSpecification | undefined,
): Partial<CatalogPublication> =>
  Object.fromEntries(
    MERCHANDISING.map(member => [member, specification?.[member]]).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  );

/** What one transition decided: the moved record, and what to announce. */
export interface OfferingTransitionDecision {
  readonly offering: ProductOffering;
  readonly event: DomainEvent<CatalogPublication>;
}

/**
 * Decide one move along an offering's lifecycle, and build what it announces.
 *
 * The rule lives in `offeringStatusAfter` and the enforcement lives **here**,
 * in the domain — not in the route that calls it. That is the whole reason this
 * exists rather than a status field the generated form could set: a status enum
 * a user can write to anything is not a lifecycle, it is a text box with four
 * suggestions.
 *
 * ⚠️ **It mutates the offering and deliberately does not save it.** The status
 * write and the outbox entry announcing it must land in one Mongo transaction
 * or a broker outage between them leaves the storefront disagreeing with the
 * vendor's own screen, permanently, with nothing to replay from. A driver
 * session may not enter the framework-free `EntityRepository` or
 * `TransactionOutbox` ports — ADR 0028 rejected threading one through by name —
 * so the **caller** commits both, exactly as a `TransactionHandler` writes its
 * own `completed` entry. This use case is the decision;
 * `transitionOfferingRoute` is the commit.
 *
 * ⚠️ **The price is loaded for an unpublish too**, and that is not waste. The
 * announced payload is the same shape either way, because the consumer's write
 * guard reads `publishedAt` off both and a payload that changes shape by event
 * name means two decoders and two ways for that guard to be skipped. It does
 * mean an offering whose only price is deleted cannot be taken down through
 * this path — recorded, and the reason the precondition is stated once here
 * rather than per transition.
 *
 * Framework-free, like every use case in this repository: both repositories
 * arrive as tags and the caller has already been authorized by the route.
 */
export const transitionOffering = Effect.gen(function* () {
  const { id, transition, vendorId, source, at } =
    yield* TransitionOfferingInputTag;
  const repository = yield* EntityRepositoryTag;

  const offering = yield* repository.get<ProductOffering>(id);
  const next = offeringStatusAfter(offering.status, transition);

  if (next === undefined) {
    return yield* new IllegalOfferingTransition({
      id,
      from: offering.status,
      transition,
    });
  }

  // ⚠️ `load` with a filter, never `get`. `makeMongoRepository`'s `get` fails an
  // absent row with `EntifixConnError` — the same class it raises when the
  // driver itself fails, and core declares no `EntifixNotFoundError` — so the
  // two are separable only by matching a message string. Mapping that failure to
  // a `409` would tell every vendor in the fleet their data is broken during a
  // Mongo outage. An empty page is unambiguous; a real failure still fails.
  const specifications = yield* OfferingSpecificationRepositoryTag;
  const specificationPage = yield* specifications.load<ProductSpecification>({
    filtering: [
      { property: 'id', operator: 'eq', value: offering.specificationId },
    ],
    pageSize: 1,
  });
  const specification = specificationPage.items[0];

  // Before the price check, deliberately: an offering naming nothing describes
  // no product at all, and sending a vendor to add a price to it points them at
  // the wrong screen. Publication only — see `OfferingHasNoSpecification`.
  if (specification === undefined && next === 'published') {
    return yield* new OfferingHasNoSpecification({
      id,
      specificationId: offering.specificationId,
    });
  }

  const prices = yield* OfferingPriceRepositoryTag;
  const page = yield* prices.load<ProductOfferingPrice>({
    filtering: [{ property: 'offeringId', operator: 'eq', value: String(id) }],
    // One is all the snapshot can carry. Several prices for one offering is a
    // real shape (per market, per term) and choosing between them is a decision
    // rather than a default — it is not this commit's.
    pageSize: 1,
  });
  const price = page.items[0];

  if (price === undefined) {
    return yield* new OfferingHasNoPrice({ id });
  }

  offering.status = next;

  const publication: CatalogPublication = {
    offeringId: String(id),
    vendorId,
    name: offering.name,
    amount: price.amount,
    currency: price.currency,
    // Nothing computes availability yet: the `stock` slice is `planned`, and M2
    // is what gives this member a source. `true` rather than `false` because
    // the storefront's badge is a hint and the checkout reservation is the
    // truth — publishing everything as unavailable would make the hint say
    // nothing while looking like it says something.
    availableHint: true,
    publishedAt: at.toISOString(),
    ...merchandisingOf(specification),
  };

  return {
    offering,
    event:
      next === 'published'
        ? catalogPublishedEvent(publication, source)
        : catalogUnpublishedEvent(publication, source),
  } satisfies OfferingTransitionDecision;
});
