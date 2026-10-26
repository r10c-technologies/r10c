import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import { makeEntityRoutes } from '@entifix/service-shell';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';

/** What a host provides for these routes. */
export type PublishedOfferingRouteServices =
  EntityRepositoryFactoryTag | TokenServiceTag | PolicyDecisionTag;

/**
 * `/api/published-offering` — the published catalog the storefront browses — a projection, written only by the projector, so there is nothing here to write. **Public**: anonymous storefront traffic reads it,
 * which is why it lives on the platform plane (ADR 0051).
 */
export const publishedOfferingRoutes = makeEntityRoutes(PublishedOffering, {
  verbs: ['list', 'get'],
  guard: { kind: 'public' },
});
