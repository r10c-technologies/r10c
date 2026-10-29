import { defineEntityApi } from '@entifix/business';
import { entityKey } from '@entifix/core';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';

/**
 * `/api/published-offering` — the published catalog the storefront browses: a
 * projection, written only by the projector, so there is nothing here to
 * write. **Public**, with the counts beside each filter choice at `$facets`
 * as public as the listing they describe: anonymous storefront traffic reads
 * both, which is why the store is on the platform plane (ADR 0051). Only a
 * `filterable` member can be counted.
 */
export const publishedOfferingApi = defineEntityApi(
  PublishedOffering,
  entityKey(PublishedOffering, 'published-offering'),
  { verbs: ['list', 'get'], guard: { kind: 'public' }, facets: true },
);
