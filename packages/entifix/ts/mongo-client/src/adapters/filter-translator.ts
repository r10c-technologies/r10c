import type {
  Entity,
  EntityFilter,
  EntityFiltering,
  EntitySorting,
  FilterGroup,
} from '@r10c/entifix-ts-core';

/** A Mongo query document (`{ field: condition, $and: [...], ... }`). */
export type MongoFilter = Record<string, unknown>;
/** A Mongo sort document (`{ field: 1 | -1 }`). */
export type MongoSort = Record<string, 1 | -1>;

const BINARY_OPERATORS: Record<string, string> = {
  eq: '$eq',
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
};

/** Escapes a string so it is matched literally inside a Mongo `$regex`. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFilterGroup<TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> {
  // A group carries `values` + a logic operator and, unlike the array filter,
  // has no `property`.
  return !('property' in node) && (node.operator === 'and' || node.operator === 'or');
}

function translateNode<TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): MongoFilter {
  if (isFilterGroup(node)) {
    const clause = node.operator === 'or' ? '$or' : '$and';
    return { [clause]: node.values.map(translateNode) };
  }

  const field = String(node.property);

  switch (node.operator) {
    case 'eq':
    case 'ne':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [field]: { [BINARY_OPERATORS[node.operator]]: node.value } };
    case 'in':
      return { [field]: { $in: node.values } };
    case 'nin':
      return { [field]: { $nin: node.values } };
    case 'between':
      return { [field]: { $gte: node.start, $lte: node.end } };
    case 'nbetween':
      return { [field]: { $not: { $gte: node.start, $lte: node.end } } };
    case 'like':
      return { [field]: { $regex: escapeRegex(node.value), $options: 'i' } };
    case 'nlike':
      return {
        [field]: { $not: { $regex: escapeRegex(node.value), $options: 'i' } },
      };
    case 'isNull':
      return { [field]: { $eq: null } };
    case 'isNotNull':
      return { [field]: { $ne: null } };
    default: {
      // Exhaustiveness guard — a new operator must be handled explicitly.
      const _never: never = node;
      return _never;
    }
  }
}

/**
 * Translates the request's `filtering` (an array of {@link EntityFiltering},
 * each a single filter, an array of filters, or a {@link FilterGroup}) into a
 * single Mongo query document. Every top-level entry is combined with `$and`;
 * an empty/absent filtering yields the match-all `{}`.
 */
export function translateFiltering<TEntity extends Entity>(
  filtering?: EntityFiltering<TEntity>[],
): MongoFilter {
  if (!filtering || filtering.length === 0) {
    return {};
  }

  const clauses: MongoFilter[] = [];
  for (const entry of filtering) {
    if (Array.isArray(entry)) {
      clauses.push(...entry.map(translateNode));
    } else {
      clauses.push(translateNode(entry));
    }
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

/**
 * Translates the request's `sorting` (an array of {@link EntitySorting} records,
 * each keyed by numeric priority) into a Mongo sort document, preserving the
 * numeric ordering within each record.
 */
export function translateSorting<TEntity extends Entity>(
  sorting?: EntitySorting<TEntity>[],
): MongoSort {
  const sort: MongoSort = {};
  if (!sorting) return sort;

  for (const record of sorting) {
    for (const priority of Object.keys(record)
      .map(Number)
      .sort((a, b) => a - b)) {
      const entry = record[priority];
      if (entry) {
        sort[String(entry.property)] = entry.type === 'desc' ? -1 : 1;
      }
    }
  }

  return sort;
}
