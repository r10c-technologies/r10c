import type { EntityFieldDescriptor } from '../describe';

/**
 * The typed value a draft string stands for.
 *
 * This is the exact inverse of the form layer's `seedFieldValue`, and the two
 * have to agree or the round trip is lossy — a member seeded from a record and
 * submitted untouched must come back equal. Two rules are not obvious:
 *
 * - **`boolean` is decided before the empty check, and never yields
 *   `undefined`.** A checkbox renders `''` as unchecked, so `''` means `false`;
 *   letting the blanket empty rule run first would write `undefined` where the
 *   user saw a box they had deliberately left clear.
 * - **`number` checks empty first.** `Number('')` is `0`, so the other order
 *   turns every blank numeric field into a real zero.
 *
 * A malformed `number` or `date` is passed through as `NaN` / an invalid `Date`
 * rather than dropped: the form's metadata validation rejects both before
 * submit, and silently discarding a value the user typed would be worse than
 * surfacing it.
 *
 * `scalarCollection` is the one collection with a lossless string form, so it
 * round-trips here rather than waiting for an editor: a comma list in, a
 * `string[]` out. It reads **empty as `[]`, never `undefined`** — a member the
 * user cleared holds no values, which is a different fact from a member that
 * was never set, and only the empty array survives a `required` check honestly.
 * `composition` has no string form at all and never reaches this function; its
 * rows are rebuilt by `reconstructChild`.
 *
 * Extracted from `reconstructEntity` so that a composition's rows coerce through
 * the **same** function their master's scalars do. Two copies of these rules is
 * how a child's `number` member would quietly start meaning something else.
 */
export function coerceFieldValue(
  descriptor: EntityFieldDescriptor,
  raw: string,
): unknown {
  if (descriptor.type === 'boolean') return raw === 'true';
  if (descriptor.type === 'scalarCollection') {
    return raw === '' ? [] : raw.split(',');
  }
  if (raw === '') return undefined;
  if (descriptor.type === 'number') return Number(raw);
  if (descriptor.type === 'date') return new Date(raw);
  return raw;
}
