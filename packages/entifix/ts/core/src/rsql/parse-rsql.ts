import { EntifixBuildError } from '../base-entities/entifix-error';
import {
  RSQL_AND,
  RSQL_COMPARISON_TOKENS,
  RSQL_NULL_TOKEN,
  RSQL_OPERATORS,
  RSQL_OR,
  rsqlArity,
  type RsqlOperator,
} from './rsql-operators';

/**
 * A parsed filter before coercion: identical to an {@link EntityFilter} except
 * every argument is still the raw string the URL carried. Re-typing needs the
 * entity's metadata, which this parser deliberately does not have — see
 * `coerce-rsql`.
 */
export type RawFilter = {
  property: string;
  operator: RsqlOperator;
  value?: string;
  values?: string[];
  start?: string;
  end?: string;
};

export type RawFilterGroup = {
  operator: 'and' | 'or';
  values: Array<RawFilter | RawFilterGroup>;
};

/**
 * Bounds on what an inbound expression may cost us. The URL comes from a
 * client, so an unbounded parser is a denial-of-service surface: deep nesting
 * would exhaust the stack and a huge disjunction would become an equally huge
 * Mongo query.
 */
const MAX_DEPTH = 16;
const MAX_NODES = 128;

const fail = (message: string, expression: string) =>
  new EntifixBuildError(`Invalid RSQL: ${message}`, undefined, { expression });

/** A property name — the RSQL selector. Kept conservative on purpose. */
const SELECTOR = /^[A-Za-z_][A-Za-z0-9_.-]*/;

interface Cursor {
  readonly text: string;
  index: number;
  nodes: number;
}

const atEnd = (cursor: Cursor) => cursor.index >= cursor.text.length;

const peek = (cursor: Cursor) => cursor.text[cursor.index];

function skipWhitespace(cursor: Cursor): void {
  while (!atEnd(cursor) && /\s/.test(cursor.text[cursor.index])) cursor.index++;
}

function countNode(cursor: Cursor): void {
  if (++cursor.nodes > MAX_NODES) {
    throw fail(`expression exceeds ${MAX_NODES} nodes`, cursor.text);
  }
}

/**
 * Reads one argument: a quoted string (either quote style, with `\` escapes) or
 * a bare run of characters up to the next grammar character. The result is
 * always a string — typing happens later, from metadata.
 */
function readValue(cursor: Cursor): string {
  skipWhitespace(cursor);
  const quoteChar = peek(cursor);

  if (quoteChar === "'" || quoteChar === '"') {
    cursor.index++;
    let value = '';
    while (!atEnd(cursor)) {
      const char = cursor.text[cursor.index];
      if (char === '\\') {
        const escaped = cursor.text[cursor.index + 1];
        if (escaped === undefined) {
          throw fail('expression ends in an escape', cursor.text);
        }
        value += escaped;
        cursor.index += 2;
        continue;
      }
      if (char === quoteChar) {
        cursor.index++;
        return value;
      }
      value += char;
      cursor.index++;
    }
    throw fail('unterminated quoted value', cursor.text);
  }

  const start = cursor.index;
  while (!atEnd(cursor) && !/[;,()\s]/.test(cursor.text[cursor.index])) {
    cursor.index++;
  }
  if (cursor.index === start) {
    throw fail('missing value', cursor.text);
  }
  return cursor.text.slice(start, cursor.index);
}

/** Reads `(a,b,…)` — the argument list of `=in=`/`=out=`/`=btn=`/`=nbtn=`. */
function readValueList(cursor: Cursor): string[] {
  skipWhitespace(cursor);
  if (peek(cursor) !== '(') {
    throw fail('expected a parenthesized value list', cursor.text);
  }
  cursor.index++;

  const values: string[] = [];
  for (;;) {
    values.push(readValue(cursor));
    skipWhitespace(cursor);
    const char = peek(cursor);
    if (char === ',') {
      cursor.index++;
      continue;
    }
    if (char === ')') {
      cursor.index++;
      return values;
    }
    throw fail('unterminated value list', cursor.text);
  }
}

/** Matches the longest comparison token at the cursor, or `undefined`. */
function readToken(cursor: Cursor): string | undefined {
  for (const token of RSQL_COMPARISON_TOKENS) {
    if (cursor.text.startsWith(token, cursor.index)) {
      cursor.index += token.length;
      return token;
    }
  }
  return undefined;
}

function parseComparison(cursor: Cursor): RawFilter {
  countNode(cursor);
  skipWhitespace(cursor);

  const selector = SELECTOR.exec(cursor.text.slice(cursor.index));
  if (!selector) {
    throw fail(
      `expected a property name at position ${cursor.index}`,
      cursor.text,
    );
  }
  const property = selector[0];
  cursor.index += property.length;

  skipWhitespace(cursor);
  const token = readToken(cursor);
  if (!token) {
    throw fail(`expected an operator after "${property}"`, cursor.text);
  }

  if (token === RSQL_NULL_TOKEN) {
    const argument = readValue(cursor);
    if (argument !== 'true' && argument !== 'false') {
      throw fail(`"${RSQL_NULL_TOKEN}" takes true or false`, cursor.text);
    }
    return {
      property,
      operator: argument === 'true' ? 'isNull' : 'isNotNull',
    };
  }

  const operator = RSQL_OPERATORS[token];

  switch (rsqlArity(operator)) {
    case 'list':
      return { property, operator, values: readValueList(cursor) };
    case 'range': {
      const bounds = readValueList(cursor);
      if (bounds.length !== 2) {
        throw fail(`"${token}" takes exactly two bounds`, cursor.text);
      }
      return { property, operator, start: bounds[0], end: bounds[1] };
    }
    default:
      return { property, operator, value: readValue(cursor) };
  }
}

/** A comparison, or a parenthesized sub-expression. */
function parsePrimary(
  cursor: Cursor,
  depth: number,
): RawFilter | RawFilterGroup {
  skipWhitespace(cursor);

  if (peek(cursor) === '(') {
    if (depth >= MAX_DEPTH) {
      throw fail(`nesting deeper than ${MAX_DEPTH} levels`, cursor.text);
    }
    cursor.index++;
    const group = parseOr(cursor, depth + 1);
    skipWhitespace(cursor);
    if (peek(cursor) !== ')') {
      throw fail('unbalanced parenthesis', cursor.text);
    }
    cursor.index++;
    return group;
  }

  return parseComparison(cursor);
}

/**
 * Collapses a single-child group into that child, so `a==1` parses to one
 * comparison rather than three nested wrappers. Keeps the parsed tree
 * comparable with the one that was serialized.
 */
function group(
  operator: 'and' | 'or',
  values: Array<RawFilter | RawFilterGroup>,
): RawFilter | RawFilterGroup {
  return values.length === 1 ? values[0] : { operator, values };
}

function parseAnd(cursor: Cursor, depth: number): RawFilter | RawFilterGroup {
  const values = [parsePrimary(cursor, depth)];
  for (;;) {
    skipWhitespace(cursor);
    if (peek(cursor) !== RSQL_AND) return group('and', values);
    cursor.index++;
    values.push(parsePrimary(cursor, depth));
  }
}

function parseOr(cursor: Cursor, depth: number): RawFilter | RawFilterGroup {
  const values = [parseAnd(cursor, depth)];
  for (;;) {
    skipWhitespace(cursor);
    if (peek(cursor) !== RSQL_OR) return group('or', values);
    cursor.index++;
    values.push(parseAnd(cursor, depth));
  }
}

/**
 * Parses an RSQL expression into a raw (still untyped) filter tree.
 *
 * Precedence follows RSQL: `,` (or) binds looser than `;` (and), and
 * parentheses override both. Values stay strings — {@link coerceFiltering} is
 * what turns them into the entity's own types, and it is also what checks the
 * properties against the metadata allowlist. Parsing alone never trusts the
 * input enough to build a query from it.
 *
 * Throws {@link EntifixBuildError} on malformed input, which services surface
 * as a `400`.
 */
export function parseRsql(expression: string): RawFilterGroup {
  const trimmed = expression.trim();
  if (trimmed === '') return { operator: 'and', values: [] };

  const cursor: Cursor = { text: trimmed, index: 0, nodes: 0 };
  const parsed = parseOr(cursor, 0);

  skipWhitespace(cursor);
  if (!atEnd(cursor)) {
    throw fail(
      `unexpected "${peek(cursor)}" at position ${cursor.index}`,
      trimmed,
    );
  }

  // The result is always a group, so callers get one shape to walk.
  return 'property' in parsed ? { operator: 'and', values: [parsed] } : parsed;
}

/** Narrows a raw node to a comparison. */
export function isRawFilter(
  node: RawFilter | RawFilterGroup,
): node is RawFilter {
  return 'property' in node;
}
