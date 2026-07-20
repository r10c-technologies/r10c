import {
  type Entity,
  EntityCollectionLink,
  type EntityFieldDescriptor,
  EntityLink,
  type MetaAccessorType,
} from '@r10c/entifix-ts-core';

/** Stand-in for an absent value, so an empty cell still reads as intentional. */
const EMPTY = '—';

/**
 * A link reads as its target's label when the target is loaded (embedded or
 * resolved), and as the bare foreign key when it is not — the same cell markup
 * covers both shapes a relation can arrive in.
 */
function entityLabel(
  target: Entity | undefined,
  linkLabelProperty: string,
): string | undefined {
  const label = (target as Record<string, unknown> | undefined)?.[
    linkLabelProperty
  ];
  return label == null ? undefined : String(label);
}

function formatLink(
  link: EntityLink<Entity>,
  linkLabelProperty: string,
): string {
  return (
    entityLabel(link.value, linkLabelProperty) ??
    (link.id == null ? EMPTY : String(link.id))
  );
}

function formatCollectionLink(
  link: EntityCollectionLink<Entity>,
  linkLabelProperty: string,
): string {
  const loaded = link.values;
  if (loaded !== undefined) {
    return loaded
      .map(
        (target, index) =>
          entityLabel(target, linkLabelProperty) ??
          String(target.id ?? link.ids[index] ?? ''),
      )
      .join(', ');
  }
  return link.ids.map(String).join(', ');
}

function formatByType(
  value: unknown,
  type: MetaAccessorType,
  linkLabelProperty: string,
): string {
  switch (type) {
    case 'date': {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString();
    }
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'link':
      return value instanceof EntityLink
        ? formatLink(value, linkLabelProperty)
        : String(value);
    case 'linkCollection':
      return value instanceof EntityCollectionLink
        ? formatCollectionLink(value, linkLabelProperty)
        : String(value);
    default:
      return String(value);
  }
}

export interface CellValueProps {
  value: unknown;
  descriptor: EntityFieldDescriptor;
}

/**
 * Renders one entity member according to its metadata type. Centralizing this
 * is what lets a table stay generic: a link, a date and a number all arrive as
 * "the value of an accessor", and only the descriptor decides how they read.
 */
export function CellValue({ value, descriptor }: CellValueProps) {
  if (value === undefined || value === null) {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  const text = formatByType(
    value,
    descriptor.type,
    descriptor.linkLabelProperty,
  );

  if (text === '') {
    return <span className="text-content-muted">{EMPTY}</span>;
  }

  return <span>{text}</span>;
}
