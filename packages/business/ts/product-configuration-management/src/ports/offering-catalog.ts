import type { Invalid, StoreFailure } from '@entifix/core';
import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Context, type Effect } from 'effect';

import type { ProductOffering } from '../entities/product-offering';
import type { ProductOfferingPrice } from '../entities/product-offering-price';
import type { ProductSpecification } from '../entities/product-specification';
import type { SpecificationLifecycleStatus } from '../values/specification-lifecycle';

/**
 * The `catalog` store's writes that are not a plain save: an offering's
 * transition with its announcement, and a re-announcement.
 */
export interface OfferingCatalog {
  /**
   * Write a transitioned offering and the event announcing it as **one
   * unit**, and only while the stored offering is still in `from` **at the
   * revision it was read at** — a compare-and-set (ADR 0010's rule pointed at
   * a record rather than a quantity). `changed` means another write landed
   * first and nothing was written: two publishes racing on one offering must
   * not both emit, and a save landing under a publish must not be overwritten
   * by what that publish read (ADR 0079 §4).
   */
  readonly commitTransition: (
    organizationId: string,
    offering: ProductOffering,
    from: ProductOffering['status'],
    event: CatalogEvent,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Write an offering's unit with the step and minimum it was reset to,
   * **only while it is still unpublished and at the revision it was read
   * at**, moving the revision in the same write (ADR 0082 §3, ADR 0079 §4).
   * `changed` means it was published, saved or is not held, and nothing was
   * written.
   */
  readonly setSaleUnit: (
    organizationId: string,
    offering: ProductOffering,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Write a price's tiers — or remove them, when it holds none — **only at
   * the revision it was read at**, moving the revision in the same write
   * (ADR 0082 §8, ADR 0079 §4). A seeded price has no revision, and is
   * matched while it still has none. `changed` means it was saved since or
   * is not held, and nothing was written.
   */
  readonly setPriceTiers: (
    organizationId: string,
    price: ProductOfferingPrice,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Write where an offering draws its stock from — or stop it drawing, when
   * it names no base — **only at the revision it was read at**, moving the
   * revision in the same write (ADR 0082 §7, ADR 0079 §4). A seeded offering
   * has no revision, and is matched while it still has none. `changed` means
   * it was saved or moved since, or is not held, and nothing was written.
   */
  readonly setStockSource: (
    organizationId: string,
    offering: ProductOffering,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Put one publication back on the outbox for the rebuild walk (ADR 0050):
   * `alreadyAnnounced` when the outbox holds it, `revived` when it held it
   * quarantined.
   */
  readonly reannounce: (
    organizationId: string,
    event: CatalogEvent,
  ) => Effect.Effect<
    'announced' | 'revived' | 'alreadyAnnounced',
    StoreFailure | Invalid
  >;
}

export class OfferingCatalogTag extends Context.Service<
  OfferingCatalogTag,
  OfferingCatalog
>()('OfferingCatalogTag') {}

/**
 * A specification's writes that are not a plain save.
 *
 * Its create draws `code` (and `specKey`) from a per-organization counter in
 * the same unit of work that writes the record, so two creates never share a
 * code and a failed write spends none. It answers the record as stored. A
 * repeated `Idempotency-Key` answers the record the first create wrote instead
 * of drawing another code.
 *
 * Its lifecycle moves, its next version and its delete are each one
 * conditional write (ADR 0079 §1): the decision is the domain's, the store
 * only refuses to write over a state that moved.
 */
export interface SpecificationCommands {
  readonly create: (
    organizationId: string,
    specification: ProductSpecification,
    idempotencyKey: string | undefined,
  ) => Effect.Effect<ProductSpecification, StoreFailure | Invalid>;
  /**
   * Write a version moved along its lifecycle, **only while it still stands
   * in `from` at the revision it was read at** — so a save landing under a
   * release is never frozen out of it — and move its `revision` in the same
   * write, so a form opened before the move cannot save over it (ADR 0079
   * §4). A release (`active`) also
   * retires, in the same unit, whichever other version of the same `specKey`
   * was active, closing its `validTo` at this one's `validFrom`: one active
   * version per key. `changed` means another move landed first and nothing
   * was written.
   */
  readonly move: (
    organizationId: string,
    specification: ProductSpecification,
    from: SpecificationLifecycleStatus,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Insert the next version of a series, at revision `1`. `changed` means a
   * version with that `specKey` and `version` already exists — another revise
   * got there first — and nothing was written.
   */
  readonly revise: (
    organizationId: string,
    next: ProductSpecification,
  ) => Effect.Effect<'committed' | 'changed', StoreFailure | Invalid>;
  /**
   * Delete a version **only while it is `in-design`**: a released version is
   * kept forever, because orders name it. `changed` means it exists and is no
   * longer in design; `absent` that there is nothing by that id.
   */
  readonly remove: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<'removed' | 'changed' | 'absent', StoreFailure | Invalid>;
}

export class SpecificationCommandsTag extends Context.Service<
  SpecificationCommandsTag,
  SpecificationCommands
>()('SpecificationCommandsTag') {}
