import {
  EntityFilterArrayOperators,
  EntityFilterBinaryOperators,
  EntityFilterNullOperators,
  EntityFilterRangeOperators,
  EntityFilterStringOperators,
  type MetaAccessorType,
} from '@r10c/entifix-ts-core';

export type EntityFilterOperator =
  | (typeof EntityFilterBinaryOperators)[number]
  | (typeof EntityFilterArrayOperators)[number]
  | (typeof EntityFilterRangeOperators)[number]
  | (typeof EntityFilterStringOperators)[number]
  | (typeof EntityFilterNullOperators)[number];

export const OPERATOR_LABELS: Record<EntityFilterOperator, string> = {
  eq: 'is',
  ne: 'is not',
  gt: 'greater than',
  gte: 'greater or equal',
  lt: 'less than',
  lte: 'less or equal',
  in: 'is one of',
  nin: 'is none of',
  between: 'between',
  nbetween: 'not between',
  like: 'contains',
  nlike: 'does not contain',
  isNull: 'is empty',
  isNotNull: 'is not empty',
};

const ORDERED: readonly EntityFilterOperator[] = [
  ...EntityFilterBinaryOperators,
  ...EntityFilterRangeOperators,
];

/**
 * Operators a user can pick for a given member type. Ordering comparisons make
 * no sense for a boolean, and substring matching makes none for a number — the
 * type is what keeps the control from offering nonsense.
 */
export function operatorsForType(
  type: MetaAccessorType,
): readonly EntityFilterOperator[] {
  switch (type) {
    case 'number':
    case 'date':
      return [...ORDERED, ...EntityFilterNullOperators];
    case 'boolean':
      return ['eq', 'ne'];
    case 'enum':
      return [
        'eq',
        'ne',
        ...EntityFilterArrayOperators,
        ...EntityFilterNullOperators,
      ];
    default:
      return [
        ...EntityFilterStringOperators,
        'eq',
        'ne',
        ...EntityFilterNullOperators,
      ];
  }
}

/** Range operators take two bounds; array operators take a list; null ops none. */
export function operatorArity(
  operator: EntityFilterOperator,
): 'none' | 'single' | 'list' | 'range' {
  if ((EntityFilterNullOperators as readonly string[]).includes(operator))
    return 'none';
  if ((EntityFilterRangeOperators as readonly string[]).includes(operator))
    return 'range';
  if ((EntityFilterArrayOperators as readonly string[]).includes(operator))
    return 'list';
  return 'single';
}
