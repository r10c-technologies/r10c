import type { TransitionalFailure } from '@entifix/core';
import type { CatalogPublication } from '@r10c/business-ts-catalog-contracts';
import { Context, type Effect } from 'effect';

/**
 * The published catalog as its projector writes it: one publication or
 * unpublication applied, **ordered on its own `publishedAt`** (ADR 0048).
 *
 * `stale` is a success, not a failure: at-least-once delivery lands old
 * events after new ones, and one that is older than what the projection
 * already knows must change nothing — whether it would have published or
 * deleted. An implementation must make that true under concurrency too, not
 * only in sequence (#357).
 */
export interface PublishedCatalog {
  readonly apply: (
    eventName: string,
    publication: CatalogPublication,
  ) => Effect.Effect<'applied' | 'stale', TransitionalFailure>;
}

export class PublishedCatalogTag extends Context.Service<
  PublishedCatalogTag,
  PublishedCatalog
>()('PublishedCatalogTag') {}
