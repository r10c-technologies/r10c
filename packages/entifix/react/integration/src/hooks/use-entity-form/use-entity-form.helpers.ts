import {
  EntityCollectionLink,
  type EntityFieldDescriptor,
  EntityLink,
} from '@r10c/entifix-ts-core';

import type { EntityFormValues } from './use-entity-form.types';

/** A member that is displayed but never edited through a plain input. */
function isReadOnlyField(descriptor: EntityFieldDescriptor): boolean {
  return (
    descriptor.readonly ||
    descriptor.type === 'link' ||
    descriptor.type === 'linkCollection'
  );
}

/**
 * The string a field seeds with from a record. Links seed with their foreign
 * key(s) and dates with a `yyyy-mm-dd` value a `date` input accepts; everything
 * else stringifies directly.
 */
export function seedFieldValue(
  descriptor: EntityFieldDescriptor,
  entity: unknown,
): string {
  if (entity == null) return '';
  const raw = (entity as Record<string, unknown>)[descriptor.name];
  if (raw == null) return '';
  if (raw instanceof EntityLink) return raw.id == null ? '' : String(raw.id);
  if (raw instanceof EntityCollectionLink) return raw.ids.map(String).join(',');
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw);
}

/** Builds the initial draft for a record (or an empty one for a create). */
export function seedEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  entity: unknown,
): EntityFormValues {
  const draft: EntityFormValues = {};
  for (const descriptor of descriptors) {
    draft[descriptor.name] = seedFieldValue(descriptor, entity);
  }
  return draft;
}

/**
 * The four metadata-derived messages, already localized. Taken as an argument
 * rather than built here so this stays a pure function — and because the
 * sentence cannot be assembled from a label plus a hardcoded suffix: word order
 * differs between locales.
 */
export interface EntityDraftMessages {
  required(field: string): string;
  number(field: string): string;
  date(field: string): string;
  option(field: string): string;
}

/**
 * Validates a draft against what the metadata implies — `required` members must
 * be filled, and a filled `number`/`date`/`enum` must be well-formed — then
 * layers any caller rules on top (which win on conflict). Read-only members and
 * relations are skipped: neither is edited through this form.
 */
export function validateEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  values: EntityFormValues,
  messages: EntityDraftMessages,
  validate?: (values: EntityFormValues) => Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const descriptor of descriptors) {
    if (isReadOnlyField(descriptor)) continue;

    const raw = values[descriptor.name] ?? '';

    if (descriptor.required && raw.trim() === '') {
      errors[descriptor.name] = messages.required(descriptor.label);
      continue;
    }
    if (raw === '') continue;

    if (descriptor.type === 'number' && Number.isNaN(Number(raw))) {
      errors[descriptor.name] = messages.number(descriptor.label);
    } else if (
      descriptor.type === 'date' &&
      Number.isNaN(new Date(raw).getTime())
    ) {
      errors[descriptor.name] = messages.date(descriptor.label);
    } else if (
      descriptor.type === 'enum' &&
      descriptor.enumValues &&
      !descriptor.enumValues.includes(raw)
    ) {
      errors[descriptor.name] = messages.option(descriptor.label);
    }
  }

  return { ...errors, ...(validate?.(values) ?? {}) };
}
