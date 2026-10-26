import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityFacetCounterFactoryTag,
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  makeEntityFacetRoutes,
  makeEntityRoutes,
} from '@entifix/service-shell';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { Layer } from 'effect';

/** What a host provides for these routes. */
export type PublishedOfferingRouteServices =
  | EntityRepositoryFactoryTag
  | EntityFacetCounterFactoryTag
  | TokenServiceTag
  | PolicyDecisionTag;

/**
 * `/api/published-offering` — the published catalog the storefront browses — a projection, written only by the projector, so there is nothing here to write. **Public**: anonymous storefront traffic reads it,
 * which is why it lives on the platform plane (ADR 0051).
 */
export const publishedOfferingRoutes = Layer.mergeAll(
  makeEntityRoutes(PublishedOffering, {
    verbs: ['list', 'get'],
    guard: { kind: 'public' },
  }),
  // `/api/published-offering/$facets` — the counts beside each filter choice
  // on a listing, as public as the listing they describe (#350). Only a
  // `filterable` member can be counted.
  makeEntityFacetRoutes(PublishedOffering, { guard: { kind: 'public' } }),
);
