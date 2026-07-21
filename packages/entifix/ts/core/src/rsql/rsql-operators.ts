import {
  EntityFilterArrayOperators,
  EntityFilterNullOperators,
  EntityFilterRangeOperators,
  EntityFilterStringOperators,
} from '../types/EntityFiltering';

/** Every operator an `EntityFilter` can carry, flattened across its variants. */
export type RsqlOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | (typeof EntityFilterArrayOperators)[number]
  | (typeof EntityFilterRangeOperators)[number]
  | (typeof EntityFilterStringOperators)[number]
  | (typeof EntityFilterNullOperators)[number];

/**
 * The RSQL token each operator is written as. `==`/`!=`/`=gt=`/`=ge=`/`=lt=`/
 * `=le=`/`=in=`/`=out=` are standard RSQL; the rest are entifix extensions,
 * named in the same `=word=` shape so a generic RSQL tokenizer still splits
 * them correctly.
 *
 * `isNull`/`isNotNull` share the `=isnull=` token and are told apart by their
 * boolean argument, because RSQL has no unary comparison.
 */
export const RSQL_TOKENS: Record<RsqlOperator, string> = {
  eq: '==',
  ne: '!=',
  gt: '=gt=',
  gte: '=ge=',
  lt: '=lt=',
  lte: '=le=',
  in: '=in=',
  nin: '=out=',
  between: '=btn=',
  nbetween: '=nbtn=',
  like: '=like=',
  nlike: '=nlike=',
  isNull: '=isnull=',
  isNotNull: '=isnull=',
};

/**
 * Token → operator. `=isnull=` is absent on purpose: it maps to two operators,
 * so the parser resolves it from the argument instead.
 */
export const RSQL_OPERATORS: Record<string, RsqlOperator> = {
  '==': 'eq',
  '!=': 'ne',
  '=gt=': 'gt',
  '=ge=': 'gte',
  '=lt=': 'lt',
  '=le=': 'lte',
  '=in=': 'in',
  '=out=': 'nin',
  '=btn=': 'between',
  '=nbtn=': 'nbetween',
  '=like=': 'like',
  '=nlike=': 'nlike',
};

/** The token shared by `isNull`/`isNotNull`. */
export const RSQL_NULL_TOKEN = '=isnull=';

/**
 * Comparison tokens ordered longest-first. The tokenizer matches greedily, so
 * `=nbtn=` must be tried before any shorter token it starts with; scanning this
 * list in order is what makes that safe as tokens are added.
 */
export const RSQL_COMPARISON_TOKENS: readonly string[] = [
  ...Object.keys(RSQL_OPERATORS),
  RSQL_NULL_TOKEN,
].sort((left, right) => right.length - left.length);

/**
 * How many arguments an operator's RSQL form carries: `none` still writes a
 * boolean argument (see `=isnull=`), `list` and `range` write a parenthesized
 * group, `single` a bare value.
 */
export function rsqlArity(
  operator: RsqlOperator,
): 'none' | 'single' | 'list' | 'range' {
  if ((EntityFilterNullOperators as readonly string[]).includes(operator))
    return 'none';
  if ((EntityFilterRangeOperators as readonly string[]).includes(operator))
    return 'range';
  if ((EntityFilterArrayOperators as readonly string[]).includes(operator))
    return 'list';
  return 'single';
}

/** Logic operator → its RSQL separator. */
export const RSQL_AND = ';';
export const RSQL_OR = ',';
