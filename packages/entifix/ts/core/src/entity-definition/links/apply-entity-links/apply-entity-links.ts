import { Entity, EntityId } from '../../../types/Entity';
import { EntityFieldDescriptor } from '../../describe';
import { EntityLink } from '../entity-link';

/**
 * The instances a user picked, keyed by accessor name — the sidecar to a form's
 * string draft.
 *
 * A draft holds ids because it must stay JSON (a workspace autosaves it), but an
 * id alone cannot be written as an embedded relation. So the picker remembers the
 * instance it handed over, and this map is that memory. It is a *cache*: the
 * draft stays the source of truth, and a missing entry only costs the embedded
 * shape, never the relation.
 */
export type EntityLinkSelection = Record<string, Entity | undefined>;

/** A draft value, as the string a native input round-trips. */
export type EntityLinkDraft = Record<string, string>;

/**
 * Writes a draft's relations onto a freshly built entity, following each
 * member's declared {@link EntityFieldDescriptor.linkSerialization}.
 *
 * This is the counterpart to `serializeEntity`, which inlines a link whenever it
 * `isLoaded`: an `embedded` member therefore needs the picked instance handed to
 * `setValue`, while an `id` member must be given only the scalar even when the
 * instance is at hand — otherwise the wire shape would flip the moment a picker
 * happened to hold the target.
 *
 * Pure and framework-free, so the same reconstruction runs in a browser form and
 * in a backend use-case that assembles an entity from a raw draft.
 *
 * `linkCollection` members are left untouched: the to-many editor is a follow-up,
 * and this is the branch where `setIds`/`setValues` will land.
 */
export function applyEntityLinks<TEntity extends Entity>(
  instance: TEntity,
  descriptors: readonly EntityFieldDescriptor[],
  values: EntityLinkDraft,
  selection: EntityLinkSelection = {},
): void {
  for (const descriptor of descriptors) {
    if (descriptor.type !== 'link') continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = (instance as any)[descriptor.name];
    // A link accessor is expected to be pre-initialized by the constructor. A
    // member typed `link` that is not one is a declaration mistake, not a value
    // to coerce — skipping keeps this helper from writing nonsense onto it.
    if (!(link instanceof EntityLink)) continue;

    const picked = selection[descriptor.name];
    const rawId = values[descriptor.name] ?? '';

    if (picked === undefined) {
      link.setValue(undefined);
      link.setId(rawId === '' ? undefined : (rawId as EntityId));
      continue;
    }

    if (descriptor.linkSerialization === 'embedded') {
      link.setValue(picked);
      continue;
    }

    link.setValue(undefined);
    link.setId(picked.id ?? (rawId === '' ? undefined : (rawId as EntityId)));
  }
}

/**
 * Seeds a {@link EntityLinkSelection} from a record whose relations already
 * arrived materialized — an embedded payload, or a link a use-case resolved.
 *
 * It is what keeps opening a loaded record from re-fetching every relation label
 * the record already carries.
 */
export function seedEntityLinkSelection<TEntity extends Entity>(
  descriptors: readonly EntityFieldDescriptor[],
  entity: TEntity | undefined,
): EntityLinkSelection {
  const selection: EntityLinkSelection = {};
  if (entity == null) return selection;

  // Only to-one links, for the same reason {@link applyEntityLinks} writes only
  // those: a collection's values are not a single selection.
  for (const descriptor of descriptors) {
    if (descriptor.type !== 'link') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const link = (entity as any)[descriptor.name];
    if (link instanceof EntityLink && link.value !== undefined) {
      selection[descriptor.name] = link.value;
    }
  }

  return selection;
}
