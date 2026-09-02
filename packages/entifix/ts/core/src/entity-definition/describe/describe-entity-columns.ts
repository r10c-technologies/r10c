import { EntifixBuildError } from '../../base-entities/entifix-error';
import { extractMetaAccessors } from '../helpers';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';
import {
  type ChildConstructor,
  type EntityLinkSerialization,
  MetaAccessor,
  MetaAccessorType,
} from '../meta-entities/meta-accessor';

/**
 * A displayable member of an entity, resolved from its accessor metadata. This
 * is the contract generic UI builds itself from — a table's columns today, a
 * form's fields later — so it stays framework-free and lives next to the
 * metadata it derives from.
 */
export interface EntityFieldDescriptor {
  /** Accessor name. The stable identity used by preferences and slots. */
  name: string;
  /** Wire/property key: `alias ?? name`. */
  key: string;
  label: string;
  /**
   * Catalog key for {@link label}, when the entity declared one. Resolution is
   * the presentation layer's job — core has no locale and no catalogs, and the
   * same descriptor feeds the server-side filter allowlist, where a translated
   * label would be meaningless.
   */
  labelKey?: string;
  type: MetaAccessorType;
  sortable: boolean;
  filterable: boolean;
  order: number;
  /** Cannot be written back. A form shows it but disables its input. */
  readonly: boolean;
  /** Must hold a value. A form rejects submit while it is empty. */
  required: boolean;
  enumValues?: readonly string[];
  /** Catalog prefix for {@link enumValues}; a value reads as `${enumLabelKey}.${value}`. */
  enumLabelKey?: string;
  /** Property of a `link` target used as its display label. */
  linkLabelProperty: string;
  /** Property of a `link` target a picker searches on. Defaults to the label. */
  linkSearchProperty: string;
  /** Whether a `link` writes back its foreign key or the inlined target. */
  linkSerialization: EntityLinkSerialization;
  /**
   * The class describing one row of a `composition` member, resolved from the
   * accessor's thunk. Absent on every other type.
   */
  childType?: ChildConstructor;
  /**
   * The member is dropped when the record is copied — a unique code, an audit
   * stamp. The identity member is always reset and is not flagged.
   */
  resetOnClone: boolean;
}

/** Types whose values are scalars a user can meaningfully sort/filter on. */
export const SCALAR_TYPES: readonly MetaAccessorType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
];

/**
 * Types whose value is a collection. None of them may ever be sorted or
 * filtered: this descriptor is also the **server-side RSQL allowlist**, and an
 * array compared as a scalar matches nothing — so the query would not fail, it
 * would quietly return an empty page.
 *
 * Exported so `describe-entity-columns.spec.ts` can assert that this list,
 * {@link SCALAR_TYPES} and the two reference types partition
 * `MetaAccessorTypes` exactly. Nothing in the repo guards `MetaAccessorType`
 * exhaustively — every switch over it has a `default` that treats the value as
 * a string — so that partition spec is what makes an eleventh type impossible
 * to add silently.
 */
export const COLLECTION_TYPES: readonly MetaAccessorType[] = [
  'linkCollection',
  'composition',
  'scalarCollection',
];

/** `productCode` / `product-code` / `product_code` → `Product Code`. */
function humanize(name: string): string {
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, first => first.toUpperCase());
}

/**
 * Best-effort type for accessors that did not declare one. Entities are not
 * required to annotate every member, so a sample row keeps a bare `@accessor()`
 * usable; a declared `type` always wins over this.
 */
function inferType(name: string, value: unknown): MetaAccessorType {
  if (value instanceof EntityLink) return 'link';
  if (value instanceof EntityCollectionLink) return 'linkCollection';
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (name === 'id') return 'id';
  return 'string';
}

/**
 * A collection member declared queryable is always a mistake, so it breaks the
 * developer rather than the query — the same posture as `applyEntityLinks`
 * throwing on an `embedded` link it cannot build.
 *
 * Silently clamping to `false` was the alternative and is worse: the author
 * keeps a declaration that reads as honoured, and the symptom is an empty
 * result page rather than an error anyone can act on.
 */
function assertNotQueryable(
  metaAccessor: MetaAccessor,
  type: MetaAccessorType,
) {
  if (!COLLECTION_TYPES.includes(type)) return;
  if (metaAccessor.sortable !== true && metaAccessor.filterable !== true)
    return;
  throw new EntifixBuildError(
    `"${String(metaAccessor.name)}" is a ${type} and cannot be sortable or filterable — member metadata is the server-side query allowlist, and a collection compared as a scalar matches nothing.`,
  );
}

function toDescriptor(
  metaAccessor: MetaAccessor,
  index: number,
  sample: unknown,
): EntityFieldDescriptor {
  const name = String(metaAccessor.name);
  const type =
    metaAccessor.type ??
    inferType(name, (sample as Record<string, unknown> | undefined)?.[name]);
  assertNotQueryable(metaAccessor, type);
  const isScalar = SCALAR_TYPES.includes(type);
  const linkLabelProperty = metaAccessor.linkLabelProperty ?? 'name';

  return {
    name,
    key: String(metaAccessor.alias ?? metaAccessor.name),
    label: metaAccessor.label ?? humanize(name),
    labelKey: metaAccessor.labelKey,
    type,
    sortable: metaAccessor.sortable ?? isScalar,
    filterable: metaAccessor.filterable ?? isScalar,
    order: metaAccessor.order ?? index,
    readonly: metaAccessor.readonly ?? false,
    required: metaAccessor.required ?? false,
    enumValues: metaAccessor.enumValues,
    enumLabelKey: metaAccessor.enumLabelKey,
    linkLabelProperty,
    linkSearchProperty: metaAccessor.linkSearchProperty ?? linkLabelProperty,
    linkSerialization: metaAccessor.linkSerialization ?? 'id',
    childType: metaAccessor.childType?.(),
    resetOnClone: metaAccessor.resetOnClone ?? false,
  };
}

/**
 * Resolves an entity's displayable members from its accessor metadata, sorted by
 * `order` (declaration order when undeclared).
 *
 * Getter-kind and non-`hidden` mirror the filter {@link serializeEntity} walks,
 * minus its `readonly` exclusion: a read-only member is still worth showing,
 * it just cannot be written back.
 *
 * `sample` is an optional instance used only to infer the `type` of accessors
 * that did not declare one.
 *
 * The target is a {@link ChildConstructor} rather than an `EntityConstructor`,
 * which is wider than it looks: nothing here reads `id`, and a `composition`
 * member's child is a **value** with accessors and no identity. So the same
 * walk describes an entity and describes one row of the collection it owns,
 * from one implementation.
 */
export function describeEntityColumns<TTarget extends object>(
  entityConstructor: ChildConstructor<TTarget>,
  sample?: TTarget,
): EntityFieldDescriptor[] {
  const seen = new Set<string>();

  return extractMetaAccessors(entityConstructor)
    .filter(metaAccessor => {
      if (metaAccessor.hidden || metaAccessor.kind !== 'getter') return false;
      const name = String(metaAccessor.name);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map((metaAccessor, index) => toDescriptor(metaAccessor, index, sample))
    .sort((left, right) => left.order - right.order);
}
