import type { SqlClient } from '@effect/sql';
import type { Statement } from '@effect/sql';
import {
  allowedDescriptors,
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
  type EntityFieldDescriptor,
  type EntityFilter,
  type EntityFilterBinaryOperator,
  type EntityFiltering,
  type EntitySorting,
  type FilterGroup,
} from '@r10c/entifix-ts-core';

/** SQL comparison for each binary operator. Fixed strings, never user input. */
const BINARY_OPERATORS: Record<EntityFilterBinaryOperator, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
};

/**
 * Escapes a value so it matches literally inside an `ILIKE` pattern: `%` and `_`
 * are the wildcards, and `\` is Postgres' default escape character, so it has to
 * escape itself first — which a single character class does for free.
 *
 * This is the SQL counterpart to the Mongo translator's `escapeRegex`: `like` is
 * an unanchored "contains" match in both, so a user typing `100%` searches for
 * that string rather than for everything.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isFilterGroup<TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> {
  // A group carries `values` + a logic operator and, unlike the array filter,
  // has no `property`.
  return (
    !('property' in node) && (node.operator === 'and' || node.operator === 'or')
  );
}

/**
 * Resolves a filter/sort member to its **column name**, or rejects it.
 *
 * This is the security boundary of this file. A property name reaches SQL as an
 * identifier, so it can never be taken on trust: it is looked up in the
 * entity's own allowlist (`filterable`/`sortable` accessor metadata, the same
 * map `coerceRsql` validates against) and only the descriptor's stored `key` is
 * ever emitted. A member the entity did not declare is an
 * {@link EntifixBuildError}, which the service maps to a `400`.
 *
 * A request arriving through `parseLoadRequestParams` has already been through
 * this gate, so this is deliberately a second check — an `EntityLoadRequest`
 * built in code reaches the adapter without passing the URL codec at all.
 */
function resolveColumn(
  property: string | number | symbol,
  allowed: Map<string, EntityFieldDescriptor>,
  requirement: 'filterable' | 'sortable',
): string {
  const name = String(property);
  const descriptor = allowed.get(name);
  if (!descriptor) {
    throw new EntifixBuildError(
      `"${name}" is not a ${requirement} member`,
      undefined,
      { property: name },
    );
  }
  return descriptor.key;
}

/**
 * Translates one filter node into a parameterized SQL fragment.
 *
 * Values are always interpolated as template parameters and column names always
 * through `sql(identifier)`, which the compiler quotes — this file never
 * concatenates a string into SQL.
 *
 * Returns `undefined` for a group with no members, which has no meaningful
 * translation (`AND ()` is a syntax error) and is dropped by the caller.
 */
function translateNode<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
  allowed: Map<string, EntityFieldDescriptor>,
): Statement.Fragment | undefined {
  if (isFilterGroup(node)) {
    const children = node.values
      .map(child => translateNode(sql, child, allowed))
      .filter((child): child is Statement.Fragment => child !== undefined);
    if (children.length === 0) return undefined;
    return node.operator === 'or' ? sql.or(children) : sql.and(children);
  }

  const column = sql(resolveColumn(node.property, allowed, 'filterable'));

  switch (node.operator) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return sql`${column} ${sql.literal(BINARY_OPERATORS[node.operator])} ${node.value}`;
    case 'in':
      return sql`${column} IN ${sql.in(node.values)}`;
    case 'nin':
      return sql`${column} NOT IN ${sql.in(node.values)}`;
    case 'between':
      return sql`${column} BETWEEN ${node.start} AND ${node.end}`;
    case 'nbetween':
      return sql`${column} NOT BETWEEN ${node.start} AND ${node.end}`;
    case 'like':
      return sql`${column} ILIKE ${`%${escapeLikePattern(node.value)}%`}`;
    case 'nlike':
      return sql`${column} NOT ILIKE ${`%${escapeLikePattern(node.value)}%`}`;
    case 'isNull':
      return sql`${column} IS NULL`;
    case 'isNotNull':
      return sql`${column} IS NOT NULL`;
    default: {
      // Exhaustiveness guard — a new operator must be handled explicitly.
      const _never: never = node;
      return _never;
    }
  }
}

/**
 * Translates the request's `filtering` into a single `WHERE`-body fragment, or
 * `undefined` when there is nothing to filter on (the caller then omits the
 * clause entirely rather than emitting `WHERE TRUE`).
 *
 * Every top-level entry is combined with `AND`, matching the Mongo translator.
 *
 * Throws {@link EntifixBuildError} for a member the entity did not declare
 * `filterable` — synchronously, because this is a framework-free codec like the
 * rest of the entifix query stack; the repository wraps it back into an Effect.
 */
export function translateFiltering<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  entityConstructor: EntityConstructor<TEntity>,
  filtering?: EntityFiltering<TEntity>[],
): Statement.Fragment | undefined {
  if (!filtering || filtering.length === 0) {
    return undefined;
  }

  const allowed = allowedDescriptors(
    entityConstructor,
    descriptor => descriptor.filterable,
  );

  const clauses: Statement.Fragment[] = [];
  for (const entry of filtering) {
    const nodes = Array.isArray(entry) ? entry : [entry];
    for (const node of nodes) {
      const clause = translateNode(sql, node, allowed);
      if (clause !== undefined) clauses.push(clause);
    }
  }

  if (clauses.length === 0) return undefined;
  if (clauses.length === 1) return clauses[0];
  return sql.and(clauses);
}

/**
 * Translates the request's `sorting` into an `ORDER BY`-body fragment, or
 * `undefined` when there is nothing to sort by.
 *
 * Priorities are applied in ascending numeric order within each record, and a
 * column named twice keeps its first position with the last direction — the same
 * outcome Mongo's sort document produces by assignment, so the two adapters
 * order identically.
 */
export function translateSorting<TEntity extends Entity>(
  sql: SqlClient.SqlClient,
  entityConstructor: EntityConstructor<TEntity>,
  sorting?: EntitySorting<TEntity>[],
): Statement.Fragment | undefined {
  if (!sorting || sorting.length === 0) {
    return undefined;
  }

  const allowed = allowedDescriptors(
    entityConstructor,
    descriptor => descriptor.sortable,
  );
  const directions = new Map<string, 'ASC' | 'DESC'>();

  for (const record of sorting) {
    for (const priority of Object.keys(record)
      .map(Number)
      .sort((left, right) => left - right)) {
      const entry = record[priority];
      if (entry) {
        directions.set(
          resolveColumn(entry.property, allowed, 'sortable'),
          entry.type === 'desc' ? 'DESC' : 'ASC',
        );
      }
    }
  }

  if (directions.size === 0) return undefined;

  return sql.csv(
    [...directions].map(
      ([column, direction]) => sql`${sql(column)} ${sql.literal(direction)}`,
    ),
  );
}
