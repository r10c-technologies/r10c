import { Entity, EntityConstructor } from '../../types/Entity';
import { extractMetaAccessors } from '../helpers';
import { EntityCollectionLink } from '../links/entity-collection-link';
import { EntityLink } from '../links/entity-link';
import { MetaAccessor, MetaAccessorType } from '../meta-entities/meta-accessor';

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
  type: MetaAccessorType;
  sortable: boolean;
  filterable: boolean;
  order: number;
  enumValues?: readonly string[];
  /** Property of a `link` target used as its display label. */
  linkLabelProperty: string;
}

/** Types whose values are scalars a user can meaningfully sort/filter on. */
const SCALAR_TYPES: readonly MetaAccessorType[] = [
  'string',
  'number',
  'boolean',
  'date',
  'enum',
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

function toDescriptor(
  metaAccessor: MetaAccessor,
  index: number,
  sample: unknown,
): EntityFieldDescriptor {
  const name = String(metaAccessor.name);
  const type =
    metaAccessor.type ??
    inferType(name, (sample as Record<string, unknown> | undefined)?.[name]);
  const isScalar = SCALAR_TYPES.includes(type);

  return {
    name,
    key: String(metaAccessor.alias ?? metaAccessor.name),
    label: metaAccessor.label ?? humanize(name),
    type,
    sortable: metaAccessor.sortable ?? isScalar,
    filterable: metaAccessor.filterable ?? isScalar,
    order: metaAccessor.order ?? index,
    enumValues: metaAccessor.enumValues,
    linkLabelProperty: metaAccessor.linkLabelProperty ?? 'name',
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
 */
export function describeEntityColumns<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  sample?: TEntity,
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
