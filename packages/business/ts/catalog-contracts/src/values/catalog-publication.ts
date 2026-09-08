import {
  type DomainEvent,
  EntifixBuildError,
  type EntifixError,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

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
 * Every member is present on `catalog.unpublished` too. An unpublication could
 * carry `offeringId` alone, and deliberately does not: the consumer's guard
 * compares `publishedAt`, and a payload that changes shape by event name means
 * two decoders and two ways for the guard to be skipped.
 */
export interface CatalogPublication {
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
  /** Minor units, matching `ProductOfferingPrice.amount`. */
  readonly amount: number;
  readonly currency: string;
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

/** Wraps a publication as a routable message from `source`. */
const message = (
  name: CatalogEventName,
  source: string,
  data: CatalogPublication,
): DomainEvent<CatalogPublication> => ({
  name,
  id: catalogEventId(data),
  source,
  at: data.publishedAt,
  correlationId: data.offeringId,
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
): DomainEvent<CatalogPublication> =>
  message(CATALOG_PUBLISHED, source, publication);

export const catalogUnpublishedEvent = (
  publication: CatalogPublication,
  source: string,
): DomainEvent<CatalogPublication> =>
  message(CATALOG_UNPUBLISHED, source, publication);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * Reads a bus payload back into a {@link CatalogPublication}.
 *
 * This exists **here** rather than in the transport for the reason
 * `readEventEnvelope` states about itself: it validates `meta` and deliberately
 * not `data`, because "the transport has no idea what a `catalog.published`
 * payload should look like, and inventing an opinion here is how the bus would
 * start knowing about domains". This package is where that opinion is allowed
 * to live, and it is the one place both the emitter and the consumer can see.
 *
 * ⚠️ **It rejects rather than coerces**, and that decides the message's fate:
 * `AmqpEventBusLayer` classifies a rejected payload as **poison** and
 * quarantines it with zero retries, while a lenient cast would turn a payload
 * that can never parse into a handler failure — requeued, counted against
 * `x-delivery-limit`, and spending the budget of every message behind it
 * (ADR 0030).
 */
export const readCatalogPublication = (
  data: unknown,
): Effect.Effect<CatalogPublication, EntifixError> =>
  Effect.gen(function* () {
    if (data === null || typeof data !== 'object') {
      return yield* Effect.fail(
        new EntifixBuildError(
          'catalog publication payload is not an object',
          undefined,
          {
            data,
          },
        ),
      );
    }

    const raw = data as Record<string, unknown>;
    const missing: string[] = [];

    if (!isNonEmptyString(raw['offeringId'])) missing.push('offeringId');
    if (!isNonEmptyString(raw['vendorId'])) missing.push('vendorId');
    if (!isNonEmptyString(raw['name'])) missing.push('name');
    if (!isNonEmptyString(raw['currency'])) missing.push('currency');
    if (!isNonEmptyString(raw['publishedAt'])) missing.push('publishedAt');
    // `Number.isFinite` and not `typeof === 'number'`: `NaN` is a number, and a
    // NaN amount reaches Mongo, stores, and renders as a price.
    if (!Number.isFinite(raw['amount'])) missing.push('amount');
    if (typeof raw['availableHint'] !== 'boolean')
      missing.push('availableHint');

    if (missing.length > 0) {
      return yield* Effect.fail(
        new EntifixBuildError(
          `catalog publication payload is missing or malformed (${missing.join(', ')})`,
          undefined,
          { missing, data },
        ),
      );
    }

    return {
      offeringId: raw['offeringId'] as string,
      vendorId: raw['vendorId'] as string,
      name: raw['name'] as string,
      amount: raw['amount'] as number,
      currency: raw['currency'] as string,
      availableHint: raw['availableHint'] as boolean,
      publishedAt: raw['publishedAt'] as string,
    };
  });
