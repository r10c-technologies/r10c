import { entityTopic, type PushTopic } from '@entifix/react-integration';

/**
 * What the catalog screens are pushed about (ADR 0072): an offering published
 * or unpublished, as a hint the list re-reads on. A publication carries the
 * storefront's snapshot rather than the offering's own shape, so it is never
 * written into the cache as a record.
 */
export const CATALOG_PUSH_TOPICS: readonly PushTopic[] = [
  entityTopic('product-offering'),
];
