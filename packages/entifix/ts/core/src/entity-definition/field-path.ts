/**
 * How an error names a member of one row of an owned collection.
 *
 * Every error map in the stack is `Record<string, string>` keyed by accessor
 * name, which has no way to say "the quantity of the third line". This is that
 * key: `items[2].quantity`.
 *
 * ## Why the index and not the row's key
 *
 * A row carries a minted `ROW_KEY` that is stable across re-renders, and it is
 * tempting to address errors by it. It cannot be done: a Standard Schema issue
 * carries a **positional** path (`['items', 2, 'quantity']`) and nothing else,
 * so an index is the only thing a schema-authored rule can produce. Building the
 * map on keys would mean the metadata rules and the schema rules addressed the
 * same cell two different ways, and `composeEntityFormErrors` merges them by key.
 *
 * The index being stale after a removal is harmless here, and only here: the
 * form re-runs its whole validator on every edit (`revalidateLogic`), so no
 * index outlives the keystroke that invalidated it. React keys cannot be
 * recomputed that way, which is exactly why rows are keyed by `ROW_KEY` and
 * errors are keyed by index — two identities, two jobs, neither substitutable
 * for the other.
 */

/** The error-map key for `member[index].child`. */
export function rowFieldPath(
  member: string,
  index: number,
  child: string,
): string {
  return `${member}[${index}].${child}`;
}

/** A parsed {@link rowFieldPath}. */
export interface RowFieldPath {
  member: string;
  index: number;
  child: string;
}

const ROW_FIELD_PATH = /^([^[\]]+)\[(\d+)]\.([^[\]]+)$/;

/**
 * Reads a {@link rowFieldPath} back, or `undefined` for a plain member name.
 *
 * The `undefined` is what keeps every existing caller working: a top-level
 * field's key is just its accessor name, which is not this shape, so a consumer
 * that only understands plain names is unaffected by the ones it cannot parse.
 */
export function parseRowFieldPath(path: string): RowFieldPath | undefined {
  const match = ROW_FIELD_PATH.exec(path);
  if (match === null) return undefined;

  return {
    member: match[1] as string,
    index: Number(match[2]),
    child: match[3] as string,
  };
}

/**
 * Joins a Standard Schema issue path into an error-map key.
 *
 * Numeric segments become `[n]` and everything else a dotted member, so
 * `['items', 2, 'quantity']` reads as `items[2].quantity` and a lone
 * `['name']` reads as `name` — which is what `issueFieldName` returned before
 * nested paths existed, so no existing rule changes meaning.
 */
export function joinFieldPath(segments: readonly (string | number)[]): string {
  return segments.reduce<string>((path, segment) => {
    if (typeof segment === 'number' || /^\d+$/.test(segment)) {
      return `${path}[${segment}]`;
    }
    return path === '' ? segment : `${path}.${segment}`;
  }, '');
}
