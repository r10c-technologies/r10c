import type { TransitionalFailure } from '@entifix/core';
import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Context, type Effect } from 'effect';

import type { ProductOffering } from '../entities/product-offering';
import type { ProductSpecification } from '../entities/product-specification';

/**
 * The `catalog` store's writes that are not a plain save: an offering's
 * transition with its announcement, and a re-announcement.
 */
export interface OfferingCatalog {
  /**
   * Write a transitioned offering and the event announcing it as **one
   * unit**, and only while the stored offering is still in `from` — a status
   * compare-and-set (ADR 0010's rule pointed at a status rather than a
   * quantity). `changed` means another transition landed first and nothing
   * was written: two publishes racing on one offering must not both emit.
   */
  readonly commitTransition: (
    organizationId: string,
    offering: ProductOffering,
    from: ProductOffering['status'],
    event: CatalogEvent,
  ) => Effect.Effect<'committed' | 'changed', TransitionalFailure>;
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
    TransitionalFailure
  >;
}

export class OfferingCatalogTag extends Context.Service<
  OfferingCatalogTag,
  OfferingCatalog
>()('OfferingCatalogTag') {}

/**
 * A specification's create is not a plain save: its `code` is the next of a
 * per-organization counter, drawn in the same unit of work that writes the
 * record, so two creates never share a code and a failed write spends none.
 * It answers the record as stored. A repeated `Idempotency-Key` answers the
 * record the first create wrote instead of drawing another code.
 */
export interface SpecificationCommands {
  readonly create: (
    organizationId: string,
    specification: ProductSpecification,
    idempotencyKey: string | undefined,
  ) => Effect.Effect<ProductSpecification, TransitionalFailure>;
}

export class SpecificationCommandsTag extends Context.Service<
  SpecificationCommandsTag,
  SpecificationCommands
>()('SpecificationCommandsTag') {}
