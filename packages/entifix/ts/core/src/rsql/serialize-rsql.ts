import type { Entity } from '../types/Entity';
import type {
  EntityFilter,
  EntityFiltering,
  FilterGroup,
  LogicOperator,
} from '../types/EntityFiltering';
import {
  RSQL_AND,
  RSQL_OR,
  RSQL_TOKENS,
  rsqlArity,
  type RsqlOperator,
} from './rsql-operators';
import { encodeRsqlValue } from './rsql-values';

/**
 * A group carries `values` + a logic operator and, unlike the array filter, has
 * no `property`. Same discriminator the Mongo `filter-translator` uses — the
 * two must agree on what counts as a group or a filter would translate one way
 * and serialize another.
 */
export function isFilterGroup<TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
): node is FilterGroup<TEntity> {
  return (
    !('property' in node) && (node.operator === 'and' || node.operator === 'or')
  );
}

const separatorFor = (operator: LogicOperator) =>
  operator === 'or' ? RSQL_OR : RSQL_AND;

/** `isNull`/`isNotNull` share one token, told apart by their boolean argument. */
const nullArgument = (operator: RsqlOperator) =>
  operator === 'isNull' ? 'true' : 'false';

function serializeComparison<TEntity extends Entity>(
  filter: EntityFilter<TEntity>,
): string {
  const operator = filter.operator as RsqlOperator;
  const property = String(filter.property);
  const token = RSQL_TOKENS[operator];

  switch (rsqlArity(operator)) {
    case 'none':
      return `${property}${token}${nullArgument(operator)}`;
    case 'list': {
      const { values } = filter as { values: unknown[] };
      return `${property}${token}(${values.map(encodeRsqlValue).join(',')})`;
    }
    case 'range': {
      const { start, end } = filter as { start: unknown; end: unknown };
      return `${property}${token}(${encodeRsqlValue(start)},${encodeRsqlValue(end)})`;
    }
    default: {
      const { value } = filter as { value: unknown };
      return `${property}${token}${encodeRsqlValue(value)}`;
    }
  }
}

/**
 * Serializes one node. `parent` is the logic operator this node's text will sit
 * inside: a group only needs parentheses when its own operator differs, since
 * `;` and `,` already read left-to-right within one operator.
 */
function serializeNode<TEntity extends Entity>(
  node: EntityFilter<TEntity> | FilterGroup<TEntity>,
  parent?: LogicOperator,
): string {
  if (!isFilterGroup(node)) return serializeComparison(node);

  const parts = node.values
    .map(child => serializeNode(child, node.operator))
    .filter(part => part !== '');

  if (parts.length === 0) return '';

  const text = parts.join(separatorFor(node.operator));
  const needsParentheses =
    parts.length > 1 && parent !== undefined && parent !== node.operator;

  return needsParentheses ? `(${text})` : text;
}

/**
 * Serializes an {@link EntityLoadRequest}'s `filtering` into an RSQL
 * expression. Every top-level entry is joined with `;` (and), mirroring how
 * `translateFiltering` combines them with `$and` on the Mongo side.
 *
 * An absent, empty, or wholly-empty filtering yields `''`, which callers omit
 * from the URL entirely rather than sending an empty parameter.
 */
export function serializeRsql<TEntity extends Entity>(
  filtering?: EntityFiltering<TEntity>[],
): string {
  if (!filtering || filtering.length === 0) return '';

  const parts: string[] = [];
  for (const entry of filtering) {
    const nodes = Array.isArray(entry) ? entry : [entry];
    for (const node of nodes) {
      const text = serializeNode(node, 'and');
      if (text !== '') parts.push(text);
    }
  }

  return parts.join(RSQL_AND);
}
