import type { TransitionalFailure } from '@entifix/core';
import type { CatalogEvent } from '@r10c/business-ts-catalog-contracts';
import { Context, type Effect } from 'effect';

import type { ProductOffering } from '../entities/product-offering';

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
 * A specification's create is a **transaction** rather than a save (ADR
 * 0028): the client mints the id, the code comes from a sequence under a
 * lock, and the write answers `202` before it is done. `accept` takes the
 * command body as sent and answers the transaction the browser goes on to
 * watch; a replayed command is accepted again, not refused.
 */
export interface SpecificationCommands {
  readonly accept: (
    organizationId: string,
    body: unknown,
  ) => Effect.Effect<{ readonly transactionId: string }, TransitionalFailure>;
}

export class SpecificationCommandsTag extends Context.Service<
  SpecificationCommandsTag,
  SpecificationCommands
>()('SpecificationCommandsTag') {}
