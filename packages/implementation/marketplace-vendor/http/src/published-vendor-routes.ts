import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import { makeEntityRoutes } from '@entifix/service-shell';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';

/** What a host provides for these routes. */
export type PublishedVendorRouteServices =
  EntityRepositoryFactoryTag | TokenServiceTag | PolicyDecisionTag;

/**
 * `/api/published-vendor` — the sellers' names the storefront renders beside each offering — a projection, written only by the projector. **Public**: anonymous storefront traffic reads it,
 * which is why it lives on the platform plane (ADR 0051).
 */
export const publishedVendorRoutes = makeEntityRoutes(PublishedVendor, {
  verbs: ['list', 'get'],
  guard: { kind: 'public' },
});
