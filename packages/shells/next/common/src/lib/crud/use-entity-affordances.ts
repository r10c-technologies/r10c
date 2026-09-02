'use client';

import { useEntityUseCases } from '@r10c/entifix-react-integration';
import type {
  Entity,
  EntityConstructor,
  EntityMetadataDocument,
  EntityMetadataSource,
} from '@r10c/entifix-ts-core';

/** What a surface needs to render an entity's served affordances. */
export interface EntityAffordances {
  metadata?: EntityMetadataDocument;
  isMetadataLoading: boolean;
}

/**
 * Reads what this caller may do with an entity, in the shape a surface spreads.
 *
 * A thin rename over `useEntityUseCases` — `isLoading` becomes
 * `isMetadataLoading` — so a page can spread the result straight into
 * `EntityForm` or `EntityTable` beside its other props, rather than restating
 * two lines at every call site. An absent source is the hook's own business.
 *
 * Absent metadata is **not** a security posture: it is the shape both surfaces
 * read as "behave exactly as before ADR 0026". The route guard is the
 * authorization boundary.
 */
export function useEntityAffordances<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  source: EntityMetadataSource | undefined,
): EntityAffordances {
  const { metadata, isLoading } = useEntityUseCases(entityConstructor, source);

  return { metadata, isMetadataLoading: isLoading };
}
