import {
  type AggregateRef,
  type AudienceEntry,
  type DomainEvent,
  Invalid,
  openStruct,
  registerEvent,
} from '@entifix/core';
import {
  type PriceTier,
  priceTiersOf,
  type SaleTerms,
  SaleTermsFields,
  saleTermsOf,
  type SaleUnit,
  stockSourceOf,
  type VariantValue,
  variantValuesOf,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { readDeviceModelIds } from './device-model-fit';
import { type MediaReferenceValue, readMedia } from './media-reference';

/**
 * A payload this process cannot read, as a typed `invalid` failure. Business
 * family, so the bus quarantines it at once rather than redelivering a message
 * no retry will fix (ADR 0030, ADR 0064).
 */
const invalidPayload = (detail: string) =>
  new Invalid({ errors: [{ pointer: '/data', detail, code: 'malformed' }] });

/**
 * A vendor's offering reached the storefront. Routing key and register name.
 *
 * @see ADR 0009 — publication projects the tenant-authored offering into the
 * platform-plane read model.
 */
export const CATALOG_PUBLISHED = 'catalog.published';

/**
 * A vendor's offering left the storefront. The projection deletes the record;
 * it does not mark it hidden, because a store carries one `truth` and a
 * `projection-of:` store that keeps rows its source no longer has is drifting
 * by construction.
 */
export const CATALOG_UNPUBLISHED = 'catalog.unpublished';

/** Every publication state the bus carries, as a routable name. */
export const CATALOG_EVENTS = [CATALOG_PUBLISHED, CATALOG_UNPUBLISHED] as const;

/** One of the two publication events. */
export type CatalogEventName = (typeof CATALOG_EVENTS)[number];

/**
 * What one publication announces — the **snapshot**, not a pointer.
 *
 * ADR 0009 is explicit and this is the shape that carries it: the projection
 * copies rather than links, because a platform-plane reader cannot dereference
 * a tenant pointer without deleting the isolation the plane split exists for,
 * and because a buyer must see the price that was published rather than one
 * edited mid-session. `vendorId` is what makes the projected record readable
 * without anything ever naming a tenant database.
 *
 * The shape does not change by event name. An unpublication could carry
 * `offeringId` alone, and deliberately does not: the consumer's guard compares
 * `publishedAt`, and a payload that varies with the event means two decoders and
 * two ways for the guard to be skipped. What varies is the *data* — an optional
 * member the specification does not carry is absent from a publication and an
 * unpublication alike.
 *
 * ⚠️ **The six optional members are optional as a safety property, not as
 * laxity.** {@link readCatalogPublication} rejecting a payload classifies the
 * message **poison**, which `AmqpEventBusLayer` quarantines with zero retries
 * (ADR 0030) — so requiring a member the source may legitimately lack makes that
 * offering permanently unannounceable, and would turn every message already
 * sitting in the queue into poison the moment this shape widened.
 */
export interface CatalogPublication extends SaleTerms {
  /** The tenant-side `ProductOffering.id`. The projection's natural key. */
  readonly offeringId: string;
  /**
   * The organization whose catalog this came from.
   *
   * Resolved from the **verified principal** at the emitting route, never from
   * a request body — the `entity.id = params.id` rule. It decides which vendor
   * a storefront row is attributed to and, once orders exist, who gets paid.
   */
  readonly vendorId: string;
  readonly name: string;
  /**
   * Minor units, matching `ProductOfferingPrice.amount`: what `pricePer` whole
   * `saleUnit`s cost. The sale terms are required, unlike the merchandising
   * below: a price without them is read as a price for one unit, which
   * charges a price per hundred a hundred times over (ADR 0082 §5).
   */
  readonly amount: number;
  readonly currency: string;
  /**
   * Where the price steps down by quantity (ADR 0082 §8): from each `from`
   * on, the whole line costs that tier's amount for `pricePer` units. Absent,
   * never `[]`, when the price has none; `tieredPrice` is what reads it.
   */
  readonly tiers?: readonly PriceTier[];
  /**
   * A presentation's base and what one of it takes from the base's stock, in
   * the base's unit (ADR 0082 §7). The coordinator reserves
   * `quantity × stockFactor` of `stockUnit` on `stockOfferingId`, and the
   * order line copies what it took. All three or none: absent, never
   * `undefined`, on an offering that draws on no base.
   */
  readonly stockOfferingId?: string;
  readonly stockFactor?: number;
  readonly stockUnit?: SaleUnit;
  /**
   * A hint, not a promise — the checkout reservation is the truth (ADR 0009,
   * ADR 0010).
   *
   * Always `true` today, because nothing computes availability yet: the `stock`
   * slice is `planned` and M2 is what gives this member a source. Recorded so
   * the shape does not have to change when it arrives.
   */
  readonly availableHint: boolean;
  /**
   * ISO-8601. When the publication was decided, and therefore the **ordering
   * key** the consumer's write guard compares.
   *
   * Not decoration. At-least-once delivery can land a redelivered
   * `catalog.unpublished` after a newer `catalog.published`, which would delete
   * a live listing permanently and silently; comparing this member is what makes
   * the register's `dedupe: 'natural'` claim actually true rather than merely
   * written down.
   */
  readonly publishedAt: string;
  /**
   * The id of the specification **version** this snapshot was taken from, and
   * that version's number (ADR 0079 §2). Required, unlike the merchandising
   * below: publishing requires an `active` pin, so no publication lacks
   * either, and an order line copies both as a record of what was sold — not
   * something a screen may show less of. Widened by a reset.
   */
  readonly specificationId: string;
  readonly specificationVersion: number;
  /**
   * The pinned specification's catalogue number — **a reference, not the
   * address**.
   *
   * A storefront URL cannot be built from it: one `ProductSpecification` may be
   * offered by several vendors, so `/p/<code>` collides, and a lookup by code
   * returns the *first* match rather than erroring — which makes the second
   * vendor's listing unreachable instead of broken. {@link
   * CatalogPublication.offeringId} is the address; this is what a buyer quotes
   * back in a support message.
   */
  readonly code?: string;
  /** The pinned specification's description — the storefront card's body. */
  readonly description?: string;
  /**
   * The brand and category the pinned specification is classified under, as
   * **plain ids into `catalog-reference`**.
   *
   * Ids and not names, deliberately. `catalog-reference` is platform plane
   * precisely because a marketplace has to *merge* a browse tree, so the
   * storefront resolves these through that domain's own read path — the same
   * host, one more read on a page it prerenders. Copying the names would freeze
   * a renamed brand into every projected record until each offering was
   * republished, and nothing walks them.
   */
  readonly brandId?: string;
  readonly categoryId?: string;
  /**
   * The pinned specification's pictures, in the vendor's order — the first is
   * the card image (ADR 0061). References, never bytes: a URL and its alt text.
   *
   * Absent rather than `[]` when there are none, for the reason `''` folds to
   * absent: an empty gallery is a slot that claims to hold something.
   */
  readonly media?: readonly MediaReferenceValue[];
  /**
   * The phones the pinned specification fits, as ids into `catalog-reference`'s
   * `DeviceModel`, or the reserved `universal` alone (plan 1.17). The
   * storefront filters on it, so it is copied rather than looked up. Absent,
   * never `[]`, when the vendor has not said.
   */
  readonly fitsDeviceModelIds?: readonly string[];
  /**
   * The specification **series** the pinned version belongs to — its
   * `specKey`, or the version's own id when it has none. Every variant of one
   * product shares it across versions, so it is what the storefront groups a
   * product's variants by (ADR 0085). Absent on a publication from before it
   * existed, which the projection reads as no group.
   */
  readonly specKey?: string;
  /**
   * The colour, size, finish or capacity this offering is of its product, in
   * the axis list's order (ADR 0085). Absent, never `[]`, when the offering is
   * no variant.
   */
  readonly variantValues?: readonly VariantValue[];
}

/**
 * The message id, and therefore the **deduplication key**.
 *
 * `<offeringId>:<publishedAt>`, never the offering id alone. ADR 0047 makes
 * `published → published` legal because republication is how a vendor's
 * correction reaches the storefront — so an id keyed on the offering would make
 * every correction look like a redelivery of the first publication and drop it.
 * Same rule `transactionEventId` follows for `<transactionId>:<step>`: one
 * subject emits many messages, so the subject alone is not an identity.
 */
export const catalogEventId = (publication: CatalogPublication): string =>
  `${publication.offeringId}:${publication.publishedAt}`;

/** A publication event: about one offering, at the version its stamp names. */
export type CatalogEvent = DomainEvent<CatalogPublication> & {
  aggregate: AggregateRef;
  version: number;
  audience: readonly AudienceEntry[];
};

/**
 * Wraps a publication as a routable message from `source`. The offering is
 * the aggregate, and `publishedAt` as epoch milliseconds is its version — the
 * same order the projector already applied (ADR 0048), now carried on the
 * message where a consumer can discard a stale one by it.
 */
const message = (
  name: CatalogEventName,
  source: string,
  data: CatalogPublication,
): CatalogEvent => ({
  name,
  id: catalogEventId(data),
  source,
  at: data.publishedAt,
  correlationId: data.offeringId,
  aggregate: { type: 'product-offering', id: data.offeringId },
  version: Date.parse(data.publishedAt),
  // The vendor whose catalog it is: their back office watches its own
  // publications.
  audience: [{ kind: 'organization', id: data.vendorId }],
  data,
});

/**
 * `source` is the **emitting slice** (`marketplace-admin`), never the
 * deployment and never the domain — ADR 0029, and it comes from
 * `EventSourceTag` at the composition root so a service that forgets it fails
 * to build its layer rather than publishing events signed by nobody.
 */
export const catalogPublishedEvent = (
  publication: CatalogPublication,
  source: string,
): CatalogEvent => message(CATALOG_PUBLISHED, source, publication);

export const catalogUnpublishedEvent = (
  publication: CatalogPublication,
  source: string,
): CatalogEvent => message(CATALOG_UNPUBLISHED, source, publication);

/**
 * What a publication's `data` must hold to be read at all — the members a
 * storefront row cannot be built without. Every optional member is accepted as
 * anything here and normalized by {@link readCatalogPublication}, which is the
 * laxity the warning on {@link CatalogPublication} explains.
 *
 * Registered for both event names, so the bus decodes a publication before any
 * handler runs (ADR 0068): a payload missing a required member is poison at the
 * edge of the consumer.
 */
export const CatalogPublicationSchema = openStruct({
  offeringId: Schema.NonEmptyString,
  vendorId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  // Finite, not merely a number: a NaN amount reaches Mongo and renders as a
  // price.
  amount: Schema.Finite,
  currency: Schema.NonEmptyString,
  availableHint: Schema.Boolean,
  publishedAt: Schema.NonEmptyString,
  specificationId: Schema.NonEmptyString,
  specificationVersion: Schema.Finite,
  ...SaleTermsFields,
});

for (const name of CATALOG_EVENTS)
  registerEvent(name, CatalogPublicationSchema, {
    versioned: true,
    audience: 'required',
  });

/**
 * The terms a decoded payload states. The schema checked each member; whether
 * the rule sells anything is checked here, so a rule no buyer could meet is
 * as malformed as a missing member.
 */
const termsOf = (
  raw: Readonly<Record<string, unknown>>,
): Effect.Effect<SaleTerms, Invalid> => {
  const terms = saleTermsOf(raw);
  return terms === undefined
    ? Effect.fail(
        invalidPayload(
          'catalog publication payload is malformed: its sale rule sells nothing',
        ),
      )
    : Effect.succeed(terms);
};

/**
 * The tiers a payload states, folded like the merchandising: none, or a list
 * that is not tier-shaped, is absent rather than poison, since an offering
 * whose tiers were lost still sells at its base price.
 */
const tiersOf = (value: unknown): Pick<CatalogPublication, 'tiers'> => {
  const tiers = priceTiersOf(value);
  return tiers === undefined ? {} : { tiers };
};

/**
 * The stock source a payload states, folded like the tiers: a partial one is
 * absent rather than poison. A presentation that lost it reserves on its own
 * id, where no stock is held, so the checkout refuses it rather than selling
 * stock nobody counted.
 */
const stockOf = (
  raw: Readonly<Record<string, unknown>>,
): Pick<CatalogPublication, 'stockOfferingId' | 'stockFactor' | 'stockUnit'> =>
  stockSourceOf(raw) ?? {};

/**
 * A variant as plain `{ axis, value }` values in the axis order, or absent
 * when the payload states none or not a well-formed one: an offering whose
 * variant was lost still sells, as a product of its own.
 */
export const plainVariant = (
  value: unknown,
): readonly VariantValue[] | undefined =>
  variantValuesOf(value)?.map(({ axis, value: chosen }) => ({
    axis,
    value: chosen,
  }));

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Reads a bus payload back into a {@link CatalogPublication}: the registered
 * schema decides whether it is one, and the optional members are folded —
 * `''` to absent, media to the entries a save would have accepted.
 */
export const readCatalogPublication = (
  data: unknown,
): Effect.Effect<CatalogPublication, Invalid> =>
  Schema.decodeUnknownEffect(CatalogPublicationSchema)(data, {
    errors: 'all',
  }).pipe(
    Effect.mapError(error =>
      invalidPayload(
        `catalog publication payload is malformed: ${error.message}`,
      ),
    ),
    Effect.flatMap(raw =>
      Effect.map(termsOf(raw), terms => ({
        offeringId: raw.offeringId,
        vendorId: raw.vendorId,
        name: raw.name,
        amount: raw.amount,
        currency: raw.currency,
        availableHint: raw.availableHint,
        publishedAt: raw.publishedAt,
        specificationId: raw.specificationId,
        specificationVersion: raw.specificationVersion,
        code: optionalString(raw['code']),
        description: optionalString(raw['description']),
        brandId: optionalString(raw['brandId']),
        categoryId: optionalString(raw['categoryId']),
        media: readMedia(raw['media']),
        fitsDeviceModelIds: readDeviceModelIds(raw['fitsDeviceModelIds']),
        specKey: optionalString(raw['specKey']),
        variantValues: plainVariant(raw['variantValues']),
        ...tiersOf(raw['tiers']),
        ...stockOf(raw),
        ...terms,
      })),
    ),
  );
