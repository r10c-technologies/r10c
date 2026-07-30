import {
  EntifixLogicError,
  EntityCollectionLink,
  type EntityFieldDescriptor,
  EntityLink,
  type StandardSchemaV1,
  type StandardSchemaV1Issue,
} from '@r10c/entifix-ts-core';

import type { EntityFormValues } from './use-entity-form.types';

/** A member no form writes back, whatever the draft says about it. */
function isNeverEdited(descriptor: EntityFieldDescriptor): boolean {
  return descriptor.readonly || descriptor.type === 'linkCollection';
}

/**
 * A member whose *format* the metadata can judge. A relation is excluded: its
 * draft value is a foreign key, and "is this a real id" is a question only the
 * service can answer — but whether one is present at all is checked, which is
 * what `required` on a relation has to mean.
 */
function hasCheckableFormat(descriptor: EntityFieldDescriptor): boolean {
  return descriptor.type !== 'link';
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

/** The slice of a form field's state this module reads: its error list. */
export interface FieldErrorMeta {
  errors?: readonly unknown[];
}

/**
 * Flattens the form engine's per-field state into the `name → message` map the
 * agnostic `EntityForm` renders. Only the first message per field survives: a
 * row shows one line, and the metadata rules already stop at the first failure.
 *
 * Kept structural rather than typed against the engine so the rest of this
 * module stays independent of which form library backs the hook.
 */
export function readFieldErrors(
  fieldMeta: Partial<Record<string, FieldErrorMeta | undefined>>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const [name, meta] of Object.entries(fieldMeta)) {
    const message = meta?.errors?.find(entry => typeof entry === 'string');
    if (typeof message === 'string') errors[name] = message;
  }

  return errors;
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
 * be filled, and a filled `number`/`date`/`enum` must be well-formed. Read-only
 * members and relations are skipped: neither is edited through this form.
 *
 * Metadata is only the first of three rule sources; {@link composeEntityFormErrors}
 * is what layers a schema and the caller's own rules over this.
 */
export function validateEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  values: EntityFormValues,
  messages: EntityDraftMessages,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const descriptor of descriptors) {
    if (isNeverEdited(descriptor)) continue;

    const raw = values[descriptor.name] ?? '';

    if (descriptor.required && raw.trim() === '') {
      errors[descriptor.name] = messages.required(descriptor.label);
      continue;
    }
    if (raw === '' || !hasCheckableFormat(descriptor)) continue;

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

  return errors;
}

/** The head of an issue's path — the field it belongs to, if it names one. */
function issueFieldName(issue: StandardSchemaV1Issue): string | undefined {
  const head = issue.path?.[0];
  if (head == null) return undefined;
  return String(typeof head === 'object' && 'key' in head ? head.key : head);
}

/**
 * Runs a Standard Schema over the draft and sorts its issues into per-field
 * messages plus a form-level one (an issue with no path — a cross-field rule).
 *
 * **Schemas are authored against the string draft**, so they coerce
 * (`z.coerce.number()`) rather than expect typed values: the draft is what the
 * inputs round-trip, and the same schema then validates exactly what the user
 * sees. Only the first issue per field survives, matching how a row renders.
 *
 * Synchronous rules only. An async schema returns a Promise the form's
 * synchronous validation pass cannot wait on, so it is rejected loudly rather
 * than silently passing.
 */
export function readSchemaIssues(
  schema: StandardSchemaV1,
  values: EntityFormValues,
  translateIssue: (message: string, field: string | undefined) => string,
): { fields: Record<string, string>; form?: string } {
  const result = schema['~standard'].validate(values);

  if (result instanceof Promise) {
    throw new EntifixLogicError(
      'useEntityForm cannot run an async schema: its validation pass is ' +
        'synchronous. Move the asynchronous rule into the `validate` option.',
    );
  }
  if (!result.issues) return { fields: {} };

  const fields: Record<string, string> = {};
  let form: string | undefined;

  for (const issue of result.issues) {
    const name = issueFieldName(issue);
    const message = translateIssue(issue.message, name);

    if (name === undefined) form ??= message;
    else fields[name] ??= message;
  }

  return { fields, form };
}

/** Everything {@link composeEntityFormErrors} needs to judge one draft. */
export interface ComposeEntityFormErrorsOptions {
  descriptors: readonly EntityFieldDescriptor[];
  values: EntityFormValues;
  messages: EntityDraftMessages;
  schema?: StandardSchemaV1;
  translateIssue: (message: string, field: string | undefined) => string;
  validate?: (values: EntityFormValues) => Record<string, string>;
}

/**
 * The single composition point for a draft's errors: metadata rules first, then
 * the entity's schema, then the caller's `validate` callback. Later sources win
 * on conflict, so a caller can always override a message it disagrees with.
 */
export function composeEntityFormErrors({
  descriptors,
  values,
  messages,
  schema,
  translateIssue,
  validate,
}: ComposeEntityFormErrorsOptions): {
  fields: Record<string, string>;
  form?: string;
} {
  const metadata = validateEntityDraft(descriptors, values, messages);
  const schemaIssues = schema
    ? readSchemaIssues(schema, values, translateIssue)
    : { fields: {}, form: undefined };

  return {
    fields: { ...metadata, ...schemaIssues.fields, ...validate?.(values) },
    form: schemaIssues.form,
  };
}
