import type { EntityRowDraft } from '../../types/EntityRowDraft';
import { describeChildColumns } from '../describe';
import type { ChildConstructor } from '../meta-entities/meta-accessor';
import { coerceFieldValue } from './coerce-field-value';

/**
 * Rebuilds one owned row from its draft.
 *
 * The master's own `reconstructEntity` in miniature, and deliberately the same
 * shape: construct zero-argument, then assign through setters, coercing each
 * draft string with the **same** `coerceFieldValue` the master's scalars use.
 * A child that declares `quantity` as a `number` therefore means the same thing
 * on a line as it would on a record.
 *
 * Three rules that are not obvious from the body.
 *
 * **The row key never reaches the child.** It is the browser's identity for the
 * row, not the entity's data — the child is a *value* with no `id` at all — so
 * writing it would put a member on the wire the entity never declared. There is
 * no check for it here because there cannot be one to make: the walk is driven
 * by `describeChildColumns`, which *throws* on a child declaring that name, so
 * no descriptor can ever carry it. A guard here would be unreachable code
 * standing in for an invariant that is already enforced.
 *
 * **A child is never `instanceof`-tested.** `ChildConstructor` is a shape
 * declaration: a row arriving off the wire is a plain object and a row arriving
 * from a draft is JSON, so the constructed instance is the only place the class
 * is real. That is also why the assignment is by `descriptor.name` and not
 * `descriptor.key` — `key` is `alias ?? name`, the storage column, which
 * `serializeEntity` applies a moment later on the way out.
 *
 * **Read-only and nested-collection members are skipped**, matching
 * `editableChildColumns`: a grid cannot write the first, and the second would
 * need a grid inside a grid, which `reconstructChild` is one level too shallow
 * to build by decision rather than by omission.
 */
export function reconstructChild<TChild extends object>(
  childType: ChildConstructor<TChild>,
  row: EntityRowDraft,
): TChild {
  const instance = new childType();

  for (const descriptor of describeChildColumns(childType, instance)) {
    if (descriptor.readonly) continue;
    if (
      descriptor.type === 'composition' ||
      descriptor.type === 'linkCollection' ||
      descriptor.type === 'link'
    ) {
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any)[descriptor.name] = coerceFieldValue(
      descriptor,
      row[descriptor.name] ?? '',
    );
  }

  return instance;
}
