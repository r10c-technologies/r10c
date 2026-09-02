import { Entity, EntityConstructor } from '../../types/Entity';
import { EntityDraft, readDraftString } from '../../types/EntityDraft';
import { isRowDraftArray } from '../../types/EntityRowDraft';
import { describeEntityColumns, EntityFieldDescriptor } from '../describe';
import {
  applyEntityLinks,
  type EntityLinkSelection,
} from '../links/apply-entity-links';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';
import { coerceFieldValue } from './coerce-field-value';
import { reconstructChild } from './reconstruct-child';

/** Everything {@link reconstructEntity} needs beyond the draft itself. */
export interface ReconstructEntityOptions<TEntity extends Entity> {
  /**
   * The record being edited. Supplies the `id` and nothing else — see
   * {@link reconstructEntity} on why it is only the id.
   */
  existing?: TEntity;
  /**
   * The instances a picker handed over, for members whose declared
   * `linkSerialization` is `embedded`. Passed straight to `applyEntityLinks`.
   */
  selection?: EntityLinkSelection;
}

/**
 * Writes an entity's owned collections back from the rows its draft holds.
 *
 * A **second pass** rather than a branch inside the scalar walk, and the reason
 * is the invariant it protects: `isWritableScalar` must go on refusing
 * `composition`, because assigning a coerced string to a member that holds rows
 * is how the master's own lines get blanked on a save that touches nothing else.
 * Keeping the two walks separate means a `composition` is written by exactly one
 * piece of code, and that code cannot be reached with a string.
 *
 * A member whose draft entry is missing or unreadable is **skipped, not
 * cleared** — the same rule the scalar walk applies to a member the form hides.
 * A draft written before this member existed, or one restored from a build that
 * did not know it, must leave the record's rows exactly as they were rather than
 * emptying them, which is a data loss the user never asked for and cannot see.
 * An explicitly empty list *is* a value and is written: that is a user who
 * removed every row.
 *
 * Read-only is honoured for the same reason as everywhere else, and the
 * `childType` guard is not defensive — a `composition` that declared no child
 * has no columns to coerce against, so there is nothing to rebuild.
 */
function applyEntityComposition(
  instance: object,
  descriptors: readonly EntityFieldDescriptor[],
  values: EntityDraft,
): void {
  for (const descriptor of descriptors) {
    if (descriptor.type !== 'composition') continue;
    if (descriptor.readonly || descriptor.childType === undefined) continue;

    const drafted = values[descriptor.name];
    if (!isRowDraftArray(drafted)) continue;

    const rows = drafted;
    const childType = descriptor.childType;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any)[descriptor.name] = rows.map(row =>
      reconstructChild(childType, row),
    );
  }
}

/**
 * A member this function must not write.
 *
 * `readonly` is the declared half — `describeEntityColumns` keeps read-only
 * members because a form still *shows* them, so unlike the column list this
 * walk has to filter them itself, exactly as `buildEntityInstance` does.
 *
 * The relation half is checked twice on purpose. The declared `link` /
 * `linkCollection` types are `applyEntityLinks`' business, and the runtime
 * `instanceof` catches a bare `@accessor()` on a relation that declared no
 * type: those accessors are getter-only, so assigning a coerced string to one
 * would throw rather than misbehave quietly.
 *
 * `composition` is excluded for the reason `linkCollection` is: it has no
 * editor yet, so a draft never holds its rows and writing one would mean
 * writing `undefined` over the master's own lines on every save. The rows'
 * write path lands with the detail control (#122). `scalarCollection` is *not*
 * excluded — it is a scalar as far as this walk is concerned, because its
 * comma-list draft coerces losslessly back to a `string[]`.
 */
function isWritableScalar(
  descriptor: EntityFieldDescriptor,
  current: unknown,
): boolean {
  if (descriptor.readonly) return false;
  if (
    descriptor.type === 'link' ||
    descriptor.type === 'linkCollection' ||
    descriptor.type === 'composition'
  ) {
    return false;
  }
  return !(
    current instanceof EntityLink || current instanceof EntityCollectionLink
  );
}

/**
 * Rebuilds a domain instance from a form's string draft, deriving every
 * assignment from the entity's own accessor metadata.
 *
 * This is the one genuinely hand-written part of an entity form, and writing it
 * per entity is a bug farm: each one repeats the same empty-string-to-undefined
 * rule, and each one has to remember to carry back a member the form hides —
 * `ProductBrand.code` is assigned by the create transaction, and dropping it
 * blanks the record's identifier on every update. Deriving the walk from the
 * metadata makes that structural instead of remembered.
 *
 * **Construction is zero-argument.** `new entityConstructor()` then assignment
 * through setters, the same shape `buildEntityInstance` uses to rebuild a record
 * off the wire. Entities default their constructor parameters, and a required
 * member is filled by its setter a moment later — so required-ness stays one
 * fact (the `@accessor({ required })` flag the form already validates against)
 * rather than a second, unverifiable list of constructor argument names.
 *
 * Constructing first also gives `describeEntityColumns` a sample, which is what
 * lets it infer `link`-ness for an accessor that declared no `type`: relations
 * are initialized by the constructor, so the fresh instance already carries them.
 *
 * **`existing` supplies the id and nothing else.** Every other member comes from
 * the draft, which was seeded from the record — so a create/update distinction
 * lives here once instead of a `target.id = entity?.id` line per form. A draft
 * may be client-supplied (a workspace autosaves it), which is not a new surface:
 * a save route already overwrites the id from its own route parameter.
 *
 * Pure and framework-free, so the same reconstruction runs in a browser form and
 * in a backend use-case assembling an entity from a raw draft.
 */
export function reconstructEntity<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  values: EntityDraft,
  { existing, selection }: ReconstructEntityOptions<TEntity> = {},
): TEntity {
  const instance = new entityConstructor();
  const descriptors = describeEntityColumns(entityConstructor, instance);

  for (const descriptor of descriptors) {
    // The draft is keyed by accessor name, and so is the assignment: `key` is
    // `alias ?? name`, which is the wire/SQL column, not the JS property.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const current = (instance as any)[descriptor.name];
    if (!isWritableScalar(descriptor, current)) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (instance as any)[descriptor.name] = coerceFieldValue(
      descriptor,
      readDraftString(values, descriptor.name),
    );
  }

  applyEntityComposition(instance, descriptors, values);
  applyEntityLinks(instance, descriptors, values, selection);

  if (existing !== undefined) instance.id = existing.id;

  return instance;
}
