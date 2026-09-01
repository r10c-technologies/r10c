import type { EntityId } from '@r10c/entifix-ts-core';

/**
 * The `[slug]` value that means "create" rather than an existing record, as in
 * `/catalog/product/new`. Reserving this one literal is the cost of addressing
 * the create form through the same dynamic segment as every record.
 */
export const CATALOG_NEW_SLUG = 'new';

/**
 * Maps a route slug to the id of the record to load. `undefined` means there is
 * nothing to load — the create case.
 */
export function slugToEntityId(slug: string | undefined): EntityId {
  return slug == null || slug === CATALOG_NEW_SLUG ? undefined : slug;
}
