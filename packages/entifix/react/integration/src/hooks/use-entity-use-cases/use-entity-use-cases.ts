import {
  type Entity,
  type EntityConstructor,
  type EntityMetadataDocument,
  type EntityMetadataSource,
  envelopeEntityName,
} from '@r10c/entifix-ts-core';
import { skipToken, useQuery } from '@tanstack/react-query';

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
  source: EntityMetadataSource | undefined,
): UseEntityUseCasesResult {
  // An **optional** source, so a caller with none to offer — a generated page
  // whose service exposes no `$metadata` route — needs no placeholder to hand
  // over. A hook cannot be called conditionally, so the query is always created
  // and simply disabled; fetching-and-failing instead would have TanStack Query
  // *retry* a rejecting promise on a loop for a capability nobody asked for.
  const enabled = source !== undefined;

  const query = useQuery({
    queryKey: ['entity-metadata', envelopeEntityName(entityConstructor)],
    // `skipToken` rather than `enabled`, because it is what lets the closure
    // keep the narrowed `source` — the `enabled` form needs a non-null
    // assertion in a `queryFn` that provably never runs.
    queryFn: source ? () => source.fetchMetadata(entityConstructor) : skipToken,
    staleTime: Infinity,
  });

  return {
    metadata: query.data,
    // A disabled query sits in `pending` forever, so `isLoading` would be
    // permanently true and every action surface would render a skeleton that
    // never resolves. Nothing is in flight when nothing was asked for.
    isLoading: enabled && query.isLoading,
    error: query.error ?? undefined,
  };
}
