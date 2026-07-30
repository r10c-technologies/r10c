import type { Entity, FilterGroup } from '@r10c/entifix-ts-core';

/**
 * ANDs filter groups, dropping the ones that say nothing.
 *
 * A group with no values matches everything, so keeping it would send a filter
 * that narrows nothing; and a single surviving group is returned as itself rather
 * than wrapped, so the serialized RSQL — which is also a query cache key — does
 * not change shape just because a restriction was configured.
 */
export function combineFilterGroups<TEntity extends Entity>(
  ...groups: ReadonlyArray<FilterGroup<TEntity> | undefined>
): FilterGroup<TEntity> | undefined {
  const meaningful = groups.filter(
    (group): group is FilterGroup<TEntity> =>
      group !== undefined && group.values.length > 0,
  );

  if (meaningful.length === 0) return undefined;
  if (meaningful.length === 1) return meaningful[0];
  return { operator: 'and', values: meaningful };
}
