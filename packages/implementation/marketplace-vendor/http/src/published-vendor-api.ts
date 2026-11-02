import { defineEntityApi } from '@entifix/business';
import { entityKey } from '@entifix/core';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';

/**
 * `/api/published-vendor` — the sellers' names the storefront renders beside
 * each offering: a projection, written only by the projector. **Public**:
 * anonymous storefront traffic reads it, which is why the store is on the
 * platform plane (ADR 0051).
 */
export const publishedVendorApi = defineEntityApi(
  PublishedVendor,
  entityKey(PublishedVendor, 'published-vendor'),
  { verbs: ['list', 'get'], guard: { kind: 'public' } },
);
