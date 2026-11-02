import type { StoreFailure } from '@entifix/core';
import type { OrganizationAnnouncement } from '@r10c/business-ts-party-contracts';
import { Context, type Effect } from 'effect';

/**
 * The sellers' names the storefront renders, as their projector writes them:
 * one organization's announcement applied, ordered on its `announcedAt`
 * (ADR 0061). An older announcement arriving after a newer one is `stale`
 * and changes nothing.
 */
export interface PublishedVendors {
  readonly apply: (
    announcement: OrganizationAnnouncement,
  ) => Effect.Effect<'applied' | 'stale', StoreFailure>;
}

export class PublishedVendorsTag extends Context.Service<
  PublishedVendorsTag,
  PublishedVendors
>()('PublishedVendorsTag') {}
