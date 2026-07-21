import { EntifixBuildError } from '../base-entities/entifix-error';
import type { Entity, EntityConstructor } from '../types/Entity';
import type { EntitySorting, EntitySortType } from '../types/EntitySorting';
import { allowedDescriptors } from './coerce-rsql';

/**
 * RSQL standardizes filtering only, so sorting travels in its own `sort`
 * parameter: `+name,-code`. The sign is the direction (`-` descending, `+` or
 * none ascending) and the list position is the precedence — which is exactly
 * what `EntitySorting`'s numeric keys mean, so the two forms map one to one.
 */
const SEPARATOR = ',';

/** Flattens the sorting records into `[property, direction]` in priority order. */
function orderedEntries<TEntity extends Entity>(
  sorting: EntitySorting<TEntity>[],
): Array<[string, EntitySortType]> {
  const entries: Array<[string, EntitySortType]> = [];

  for (const record of sorting) {
    for (const priority of Object.keys(record)
      .map(Number)
      .sort((left, right) => left - right)) {
      const entry = record[priority];
      if (entry) entries.push([String(entry.property), entry.type]);
    }
  }

  return entries;
}

/**
 * Serializes an {@link EntityLoadRequest}'s `sorting` into the `sort`
 * parameter's value. Absent or empty sorting yields `''`, which callers omit
 * from the URL rather than sending empty.
 */
export function serializeSort<TEntity extends Entity>(
  sorting?: EntitySorting<TEntity>[],
): string {
  if (!sorting || sorting.length === 0) return '';

  return orderedEntries(sorting)
    .map(([property, type]) => `${type === 'desc' ? '-' : '+'}${property}`)
    .join(SEPARATOR);
}

/**
 * Parses the `sort` parameter into the request's `sorting`, allowlisting every
 * member against the entity's `sortable` metadata for the same reason
 * {@link coerceFiltering} does: an unchecked property name would let a client
 * sort by a member the entity never meant to expose, and an unindexed one is a
 * collection scan.
 *
 * Returns a single-record array — one record whose numeric keys carry the
 * precedence — or `undefined` when there is nothing to sort by.
 */
export function parseSort<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  parameter: string | null | undefined,
): EntitySorting<TEntity>[] | undefined {
  const text = parameter?.trim();
  if (!text) return undefined;

  const allowed = allowedDescriptors(
    entityConstructor,
    descriptor => descriptor.sortable,
  );

  const record = {} as EntitySorting<TEntity>;
  let priority = 0;

  for (const rawTerm of text.split(SEPARATOR)) {
    const term = rawTerm.trim();
    if (term === '') continue;

    const type: EntitySortType = term.startsWith('-') ? 'desc' : 'asc';
    const name = term.replace(/^[+-]/, '');
    const descriptor = allowed.get(name);

    if (!descriptor) {
      throw new EntifixBuildError(
        `"${name}" is not a sortable member`,
        undefined,
        { property: name },
      );
    }

    record[priority++] = { property: descriptor.key as keyof TEntity, type };
  }

  return priority === 0 ? undefined : [record];
}
