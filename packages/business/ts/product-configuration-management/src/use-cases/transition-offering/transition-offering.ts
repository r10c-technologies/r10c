import { EntityRepositoryTag } from '@entifix/business';
import { type EntityId, Failure } from '@entifix/core';
import {
  type CatalogEvent,
  type CatalogPublication,
  catalogPublishedEvent,
  catalogUnpublishedEvent,
  plainVariant,
  readDeviceModelIds,
  readMedia,
} from '@r10c/business-ts-catalog-contracts';
import {
  isStockFactor,
  KitInvalid,
  type KitStock,
  kitShapeRefusal,
  kitStockOf,
  PRESENTATION_UNIT,
  priceTiersRefusal,
  type StockSource,
  StockSourceInvalid,
} from '@r10c/business-ts-sales-vocabulary';
import { Context, Effect, Schema } from 'effect';

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
   * `@entifix/transactions`: this package would gain a dependency on the
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
  /**
   * Restating a publication that already happened — the rebuild walk
   * (ADR 0050) — rather than deciding a new one. The active-pin rule is a
   * rule about **going on sale**, so it does not run: an offering published
   * on version 1 stays on sale on version 1 after version 2 is released, and a
   * rebuild that refused to restate it would empty the storefront of exactly
   * the offerings ADR 0079 §2 says nothing moves.
   */
  readonly restating?: boolean;
}

export class TransitionOfferingInputTag extends Context.Service<
  TransitionOfferingInputTag,
  TransitionOfferingInput
>()('TransitionOfferingInputTag') {}

/**
 * The offering's prices, as a second repository.
 *
 * A separate tag rather than a second use of `EntityRepositoryTag`, because one
 * tag resolves to one value: providing `EntityRepositoryTag` twice in the same
 * effect gives both reads whichever was provided last, and a repository built
 * for `ProductOffering` answering a price query returns documents that
 * deserialize into the wrong class rather than failing.
 */
export class OfferingPriceRepositoryTag extends Context.Service<
  OfferingPriceRepositoryTag,
  EntityRepositoryTag['Service']
>()('OfferingPriceRepositoryTag') {}

/**
 * The offering's pinned specification, as a third repository — a separate tag
 * for the same reason the prices are.
 *
 * It exists because the storefront cannot read tenant storage: the merchandising
 * fields a card and a product page render live on `ProductSpecification`, so the
 * snapshot has to copy them at publication or they never reach the platform
 * plane at all (ADR 0009).
 */
export class OfferingSpecificationRepositoryTag extends Context.Service<
  OfferingSpecificationRepositoryTag,
  EntityRepositoryTag['Service']
>()('OfferingSpecificationRepositoryTag') {}

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
export class IllegalOfferingTransition extends Failure.conflict<IllegalOfferingTransition>()(
  'IllegalOfferingTransition',
  ILLEGAL_OFFERING_TRANSITION,
  { id: Schema.String, from: Schema.String, transition: Schema.String },
  {
    message: ({ from, transition }) =>
      `an offering in '${from}' cannot be ${transition}ed`,
  },
) {}

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
export class OfferingHasNoPrice extends Failure.conflict<OfferingHasNoPrice>()(
  'OfferingHasNoPrice',
  OFFERING_HAS_NO_PRICE,
  { id: Schema.String },
  {
    message: () =>
      'an offering needs a price before it can reach the storefront: the ' +
      'published record carries an amount and a currency',
  },
) {}

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
export class OfferingHasNoSpecification extends Failure.conflict<OfferingHasNoSpecification>()(
  'OfferingHasNoSpecification',
  OFFERING_HAS_NO_SPECIFICATION,
  { id: Schema.String, specificationId: Schema.String },
  {
    message: ({ specificationId }) =>
      `this offering names specification '${specificationId}', which no ` +
      'longer exists; the published record copies its name, description, ' +
      'brand and category',
  },
) {}

/** The code a route renders when the pinned version is not the one on sale. */
export const SPECIFICATION_NOT_ACTIVE = 'specificationNotActive';

/**
 * An offering asked to reach the storefront while pinning a version that is
 * not `active` — still in design, or retired (ADR 0079 §2). A pin is the id of
 * one version record, and only a released, current one may go on sale; a
 * draft would sell content its author has not frozen. Publication only, like
 * the missing specification: a takedown is never refused for what it pins.
 */
export class SpecificationNotActive extends Failure.conflict<SpecificationNotActive>()(
  'SpecificationNotActive',
  SPECIFICATION_NOT_ACTIVE,
  {
    id: Schema.String,
    specificationId: Schema.String,
    standing: Schema.String,
  },
  {
    message: ({ standing }) =>
      `this offering pins a specification version that is '${standing}'; ` +
      'only an active version may be published',
  },
) {}

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
  offering: ProductOffering,
  specification: ProductSpecification | undefined,
): Partial<CatalogPublication> => {
  // The offering's own pictures win: a black case is not the blue one's
  // photo (ADR 0085). Absent, the specification's (ADR 0061).
  const media = readMedia(offering.media) ?? readMedia(specification?.media);
  const variantValues = plainVariant(offering.variantValues);
  const specKey =
    specification === undefined
      ? undefined
      : (specification.specKey ?? String(specification.id));
  const fitsDeviceModelIds = readDeviceModelIds(
    specification?.fitsDeviceModelIds,
  );
  return {
    ...Object.fromEntries(
      MERCHANDISING.map(member => [member, specification?.[member]]).filter(
        ([, value]) => value !== undefined && value !== '',
      ),
    ),
    // The same absent-not-`undefined` rule, for a collection: no pictures is
    // no key, never `[]`. Read through `readMedia` so what is announced is
    // plain `{ url, alt }` values the save already accepted (ADR 0061).
    ...(media === undefined ? {} : { media }),
    ...(fitsDeviceModelIds === undefined ? {} : { fitsDeviceModelIds }),
    ...(specKey === undefined ? {} : { specKey }),
    ...(variantValues === undefined ? {} : { variantValues }),
  };
};

/**
 * The version the snapshot was taken from (ADR 0079 §2). A publication always
 * has one — publishing requires an `active` pin — but a takedown of an
 * offering whose specification is gone announces the id it names and version
 * `0`, so the payload keeps one shape by event name.
 */
const pinOf = (
  offering: ProductOffering,
  specification: ProductSpecification | undefined,
): Pick<CatalogPublication, 'specificationId' | 'specificationVersion'> => ({
  specificationId: String(specification?.id ?? offering.specificationId),
  specificationVersion: specification?.version ?? 0,
});

/** What one transition decided: the moved record, and what to announce. */
export interface OfferingTransitionDecision {
  readonly offering: ProductOffering;
  /**
   * The status the offering was read in. What a commit compares against, so
   * two transitions racing on one offering cannot both land (#371).
   */
  readonly from: ProductOffering['status'];
  readonly event: CatalogEvent;
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
/**
 * The stock source a presentation publishes with, `undefined` for an offering
 * that draws on no base, or the problem that keeps it from being drawn on.
 *
 * ⚠️ `load` with a filter, never `get`, for the same reason as the
 * specification: a base that is gone is a value this decides on.
 */
const stockSourceOf = (
  repository: EntityRepositoryTag['Service'],
  offering: ProductOffering,
) =>
  Effect.gen(function* () {
    const { stockOfferingId, stockFactor } = offering;
    if (stockOfferingId === undefined) return undefined;
    if (offering.saleUnit !== PRESENTATION_UNIT) return 'notCounted' as const;
    if (!isStockFactor(stockFactor)) return 'factor' as const;
    const page = yield* repository.load<ProductOffering>({
      filtering: [{ property: 'id', operator: 'eq', value: stockOfferingId }],
      pageSize: 1,
    });
    const base = page.items[0];
    if (base === undefined) return 'baseMissing' as const;
    if (base.stockOfferingId !== undefined)
      return 'baseIsPresentation' as const;
    return {
      stockOfferingId,
      stockFactor,
      stockUnit: base.saleUnit,
    } satisfies StockSource;
  });

/**
 * What one kit takes from each component's stock, `undefined` for an offering
 * that is not a kit, or the problem that keeps it from being sold
 * ([ADR 0086](../../../../../../../docs/adr/0086-a-kit-sells-several-offerings-at-one-price.md)).
 * `set-kit` checked the components when it was set, but nothing locks them,
 * so publication checks them again: each must still be in the catalog, sold
 * in `UN`, no kit, and on sale itself — a kit whose case was taken down would
 * sell a case nobody offers. A component that is a presentation is resolved
 * to its base, as its own publication is.
 */
const kitStockOfOffering = (
  repository: EntityRepositoryTag['Service'],
  offering: ProductOffering,
) =>
  Effect.gen(function* () {
    const components = offering.kitComponents;
    if (components === undefined || components.length === 0) return undefined;
    const shape = kitShapeRefusal(String(offering.id), components);
    if (shape !== undefined) return shape;
    if (offering.saleUnit !== PRESENTATION_UNIT) return 'notCounted' as const;
    const page = yield* repository.load<ProductOffering>({
      filtering: [
        {
          property: 'id',
          operator: 'in',
          value: components.map(component => component.offeringId),
        },
      ],
      pageSize: components.length,
    });
    const byId = new Map(page.items.map(item => [String(item.id), item]));
    const resolved: KitStock[] = [];
    for (const { offeringId, quantity } of components) {
      const component = byId.get(offeringId);
      if (component === undefined) return 'componentMissing' as const;
      if ((component.kitSize ?? 0) > 0) return 'componentIsKit' as const;
      if (component.saleUnit !== PRESENTATION_UNIT)
        return 'componentNotCounted' as const;
      if (component.status !== 'published')
        return 'componentUnpublished' as const;
      const source = yield* stockSourceOf(repository, component);
      // A component that cannot be drawn on is as unsellable as a missing one.
      if (typeof source === 'string') return 'componentMissing' as const;
      resolved.push(kitStockOf({ offeringId, quantity }, source));
    }
    return resolved;
  });

/**
 * What an offering on sale announces, from the records it is made of: its
 * price, its pinned specification's merchandising and its stock source. Pure,
 * so the transition and the import (ADR 0084) build one payload one way.
 */
export const offeringPublication = (input: {
  readonly offering: ProductOffering;
  readonly specification: ProductSpecification | undefined;
  readonly price: ProductOfferingPrice;
  readonly vendorId: string;
  readonly at: Date;
  readonly stockSource?: StockSource;
  readonly kitComponents?: readonly KitStock[];
}): CatalogPublication => {
  const { offering, specification, price, vendorId, at, stockSource } = input;
  const kitComponents = input.kitComponents;
  const tiers = price.tiers;
  return {
    offeringId: String(offering.id),
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
    // What the price buys and how a buyer may ask for it (ADR 0082). The save
    // rules already refused a rule that sells nothing and a basis other than
    // 1, 100 or 1000, so these are copied as stored.
    saleUnit: offering.saleUnit,
    quantityStep: offering.quantityStep,
    quantityMinimum: offering.quantityMinimum,
    pricePer: price.pricePer,
    // Absent, never `[]`, when the price has none (ADR 0049).
    ...(tiers === undefined || tiers.length === 0
      ? {}
      : { tiers: tiers.map(({ from, amount }) => ({ from, amount })) }),
    // Absent, never `undefined`, on an offering that draws on no base.
    ...(stockSource ?? {}),
    // Absent, never `[]`, on an offering that is not a kit (ADR 0086).
    ...(kitComponents === undefined || kitComponents.length === 0
      ? {}
      : {
          kitComponents: kitComponents.map(component => ({
            offeringId: component.offeringId,
            quantity: component.quantity,
            stockOfferingId: component.stockOfferingId,
            stockUnit: component.stockUnit,
            stockQuantity: component.stockQuantity,
          })),
        }),
    ...pinOf(offering, specification),
    ...merchandisingOf(offering, specification),
  };
};

export const transitionOffering = Effect.gen(function* () {
  const { id, transition, vendorId, source, at, restating } =
    yield* TransitionOfferingInputTag;
  const repository = yield* EntityRepositoryTag;

  const offering = yield* repository.get<ProductOffering>(id);
  const from = offering.status;
  const next = offeringStatusAfter(from, transition);

  if (next === undefined) {
    return yield* new IllegalOfferingTransition({
      id: String(id),
      from: offering.status,
      transition,
    });
  }

  // ⚠️ `load` with a filter, never `get`: an absent specification is a value
  // this decides on, and an empty page keeps it one — never a failure that
  // could be confused with the store being down. A real failure still fails.
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
      id: String(id),
      specificationId: offering.specificationId,
    });
  }

  // The pin must name the series' current, frozen version. After the
  // existence check: an offering naming nothing needs a specification, not a
  // release.
  if (
    specification !== undefined &&
    next === 'published' &&
    restating !== true &&
    specification.lifecycleStatus !== 'active'
  ) {
    return yield* new SpecificationNotActive({
      id: String(id),
      specificationId: offering.specificationId,
      standing: String(specification.lifecycleStatus),
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
    return yield* new OfferingHasNoPrice({ id: String(id) });
  }

  // The tiers were checked against the rule when they were set, but the unit
  // can still change before a first publication, and `set-sale-unit` resets
  // the step and minimum under them (ADR 0082 §8). Publication only: a
  // takedown announces whatever was published.
  const tiers = price.tiers;
  if (tiers !== undefined && next === 'published') {
    const refused = priceTiersRefusal(tiers, price, offering);
    if (refused !== undefined) return yield* refused;
  }

  // A presentation carries its base and the base's unit (ADR 0082 §7): the
  // coordinator reserves on the base and reads no catalog. `draw-on-stock`
  // checked the base when it was set, but nothing locks it, so publication
  // checks it again. A takedown announces whatever it can still name.
  const stockSource = yield* stockSourceOf(repository, offering);
  if (typeof stockSource === 'string' && next === 'published')
    return yield* new StockSourceInvalid({ problem: stockSource });

  // A kit carries what one kit takes from each component (ADR 0086), checked
  // again for the same reason. A takedown announces whatever it can resolve.
  const kit = yield* kitStockOfOffering(repository, offering);
  if (typeof kit === 'string' && next === 'published')
    return yield* new KitInvalid({ problem: kit });

  offering.status = next;
  // ⚠️ Stamped on **both** transitions, and stored rather than only announced.
  // It is the same value the payload carries as `publishedAt` and therefore the
  // second half of `catalogEventId`, so a rebuild re-emitting it reproduces this
  // announcement exactly instead of minting a new one — see the member's own
  // comment for what a re-stamped `now` would do to the projection's ordering.
  offering.statusChangedAt = at;

  const publication = offeringPublication({
    offering,
    specification,
    price,
    vendorId,
    at,
    ...(typeof stockSource === 'object' ? { stockSource } : {}),
    ...(Array.isArray(kit) ? { kitComponents: kit } : {}),
  });

  return {
    offering,
    from,
    event:
      next === 'published'
        ? catalogPublishedEvent(publication, source)
        : catalogUnpublishedEvent(publication, source),
  } satisfies OfferingTransitionDecision;
});
