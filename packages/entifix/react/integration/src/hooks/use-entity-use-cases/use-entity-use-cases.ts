import {
  type Entity,
  type EntityConstructor,
  type EntityMetadataDocument,
  type EntityMetadataSource,
  envelopeEntityName,
} from '@r10c/entifix-ts-core';
import { useQuery } from '@tanstack/react-query';

export interface UseEntityUseCasesResult {
  /** Undefined until the document arrives; a surface renders its defaults meanwhile. */
  metadata?: EntityMetadataDocument;
  isLoading: boolean;
  error?: unknown;
}

/**
 * Reads what this caller may do with an entity, from the service.
 *
 * The source is a parameter rather than resolved from context because the two
 * consumers reach their service differently — one through the config-driven REST
 * adapters, one through a shell's own same-origin routes — and a hook that knew
 * about both would have to know about neither's layer.
 *
 * The query key sits under `'entity-metadata'`, deliberately **outside** the
 * `['entity', …]` namespace: `useReactiveInvalidation` invalidates
 * `['entity', <key>]` wholesale whenever a row changes, and affordances do not
 * change when a record does. Keeping it out is what stops every save refetching
 * this. `staleTime: Infinity` for the same reason — the document changes with
 * the deployment and the caller's grants, neither of which moves inside a
 * session.
 */
export function useEntityUseCases<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  source: EntityMetadataSource,
): UseEntityUseCasesResult {
  const query = useQuery({
    queryKey: ['entity-metadata', envelopeEntityName(entityConstructor)],
    queryFn: () => source.fetchMetadata(entityConstructor),
    staleTime: Infinity,
  });

  return {
    metadata: query.data,
    isLoading: query.isLoading,
    error: query.error ?? undefined,
  };
}
