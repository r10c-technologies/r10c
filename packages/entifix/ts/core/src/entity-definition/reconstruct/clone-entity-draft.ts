import { Entity, EntityConstructor } from '../../types/Entity';
import { EntityDraft } from '../../types/EntityDraft';
import { describeEntityColumns } from '../describe';

/** The member `Entity` requires every record to carry. */
const ID_MEMBER = 'id';

/**
 * The draft for a copy of a record: everything the original held, minus the
 * members a copy must not carry.
 *
 * **A draft in and a draft out**, rather than an instance in and an instance
 * out, and that is the whole reason this composes with the rest of the form
 * layer. A form's state is a `Record<string, string>` that a workspace
 * autosaves (ADR 0032), so a clone that returned an instance would have to be
 * re-seeded back into a draft by the caller — through `seedFieldValue`, which
 * lives in a package above this one. Staying in the draft keeps the operation
 * on one side of that boundary, and `reconstructEntity` is still what turns the
 * result into an entity at submit.
 *
 * Two kinds of member are dropped:
 *
 * - **the identity member**, always, with no flag — a copy that carries the
 *   original's `id` is an update to the original, which is the one outcome a
 *   Clone button must never produce;
 * - **anything declared `@accessor({ resetOnClone: true })`** — a unique code,
 *   an audit stamp, a sequence number.
 *
 * Cleared to `''` rather than deleted, because `''` is what an empty control
 * drafts as: a member removed from the record entirely would arrive
 * `undefined`, and an input handed `undefined` flips from controlled to
 * uncontrolled — the same trap `restoreEntityDraft` layers a restored draft
 * over a seeded one to avoid.
 *
 * A member the entity declares but the draft never held stays absent, so this
 * neither invents keys nor widens the draft.
 */
export function cloneEntityDraft<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  values: EntityDraft,
): EntityDraft {
  const cloned: EntityDraft = { ...values };

  // The identity member, cleared **without consulting the descriptors**.
  // `describeEntityColumns` drops `hidden` members, and a form hiding its id is
  // the ordinary case rather than the exotic one — every generated catalog page
  // does it — so a descriptor-driven sweep would leave the id in place on
  // exactly the forms a Clone button appears on, and the "copy" would silently
  // save over the original. `Entity` fixes this member's name, so there is no
  // metadata to consult anyway.
  if (ID_MEMBER in cloned) cloned[ID_MEMBER] = '';

  for (const descriptor of describeEntityColumns(entityConstructor)) {
    if (descriptor.type !== 'id' && !descriptor.resetOnClone) continue;
    if (!(descriptor.name in cloned)) continue;
    cloned[descriptor.name] = '';
  }

  return cloned;
}
