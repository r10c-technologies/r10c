import {
  describeChildColumns,
  editableChildColumns,
  EntifixLogicError,
  EntityCollectionLink,
  type EntityDraft,
  type EntityDraftValue,
  type EntityFieldDescriptor,
  EntityLink,
  type EntityRowDraft,
  isRowDraftArray,
  joinFieldPath,
  readDraftString,
  readRowDrafts,
  ROW_KEY,
  rowFieldPath,
  seededRowKey,
  type StandardSchemaV1,
  type StandardSchemaV1Issue,
} from '@r10c/entifix-ts-core';

/**
 * A member no form writes back, whatever the draft says about it — and the only
 * one is a read-only member, because it is the only one no editor may ever
 * exist for.
 *
 * `linkCollection` used to be here too, which meant `required` on a to-many
 * relation was silently unenforced: a rule the entity declared and the form
 * never applied. Whether a collection has an editor yet is a question about the
 * controls, not about what the domain insists on, so it is excluded from the
 * *format* check below instead.
 */
function isNeverEdited(descriptor: EntityFieldDescriptor): boolean {
  return descriptor.readonly;
}

/**
 * A member whose *format* the metadata can judge. Both relation shapes are
 * excluded: their draft value is a foreign key (or a joined list of them), and
 * "is this a real id" is a question only the service can answer — but whether
 * one is present at all is checked, which is what `required` on a relation has
 * to mean.
 *
 * A `composition` is excluded here too, but it is no longer unjudged: its rows
 * are checked one at a time by {@link validateRowDrafts}, against the child's
 * own descriptors. What has no meaning is a *format* rule on the collection
 * itself — there is no string to judge, only rows.
 *
 * `scalarCollection` is deliberately *not* excluded — its comma list is real
 * text the user typed.
 */
function hasCheckableFormat(descriptor: EntityFieldDescriptor): boolean {
  return (
    descriptor.type !== 'link' &&
    descriptor.type !== 'linkCollection' &&
    descriptor.type !== 'composition'
  );
}

/**
 * The value a field seeds with from a record.
 *
 * A scalar seeds as a **string**: links with their foreign key(s), dates with a
 * `yyyy-mm-dd` value a `date` input accepts, everything else stringified.
 *
 * The array branch is explicit rather than left to `String(raw)`, even though
 * the two produce the same characters today. `String(['a','b'])` is `'a,b'` by
 * way of `Array.prototype.toString`, which is an accident: it was doing the
 * work of a `scalarCollection` seed before the type existed, and
 * `reconstructEntity` was handing the same string straight back as a `string`.
 * Both halves were wrong in the same direction, so the fixed-point spec could
 * not see it. Now the join is declared here and the split is declared there,
 * and they are inverses on purpose.
 *
 * A **`composition`** is the one member that does not seed as a string, because
 * it has no lossless string form at all — its rows seed as row drafts, each
 * with a freshly minted key. That key is the only thing here the record does not
 * supply, and it is minted at seed time rather than at render so that the rows a
 * form starts with are already addressable.
 */
export function seedFieldValue(
  descriptor: EntityFieldDescriptor,
  entity: unknown,
): EntityDraftValue {
  if (descriptor.type === 'composition') {
    return seedRowDrafts(descriptor, entity);
  }
  return seedScalarValue(descriptor, entity);
}

/** {@link seedFieldValue} for every member that round-trips through a string. */
function seedScalarValue(
  descriptor: EntityFieldDescriptor,
  entity: unknown,
): string {
  if (entity == null) return '';
  const raw = (entity as Record<string, unknown>)[descriptor.name];
  if (raw == null) return '';
  if (raw instanceof EntityLink) return raw.id == null ? '' : String(raw.id);
  if (raw instanceof EntityCollectionLink) return raw.ids.map(String).join(',');
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (Array.isArray(raw)) return raw.map(String).join(',');
  return String(raw);
}

/**
 * The rows a composition member seeds with.
 *
 * Each row is walked with the child's **own** descriptors, through the same
 * `seedScalarValue` the master's members use — so a child's `date` seeds as
 * `yyyy-mm-dd` on a line exactly as it would on a record, and
 * `reconstructChild` is its inverse for the same reason `coerceFieldValue` is.
 *
 * A row arrives as a plain object as readily as an instance (a payload off the
 * wire, a fixture), which is fine: nothing here asks what class it is, matching
 * `ChildConstructor`'s rule that a child is never `instanceof`-tested.
 *
 * A member with no declared child seeds as no rows — there are no columns to
 * walk, so there is nothing a row could be.
 */
function seedRowDrafts(
  descriptor: EntityFieldDescriptor,
  entity: unknown,
): EntityRowDraft[] {
  if (entity == null || descriptor.childType === undefined) return [];
  const raw = (entity as Record<string, unknown>)[descriptor.name];
  if (!Array.isArray(raw)) return [];

  const columns = describeChildColumns(descriptor.childType);

  return raw.map((row, index) => {
    // Deterministic, so re-seeding the same record produces the same draft —
    // see `seededRowKey` for the render loop the random one causes.
    const draft: EntityRowDraft = { [ROW_KEY]: seededRowKey(index) };
    for (const column of columns) {
      draft[column.name] = seedScalarValue(column, row);
    }
    return draft;
  });
}

/** Builds the initial draft for a record (or an empty one for a create). */
export function seedEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  entity: unknown,
): EntityDraft {
  const draft: EntityDraft = {};
  for (const descriptor of descriptors) {
    draft[descriptor.name] = seedFieldValue(descriptor, entity);
  }
  return draft;
}

/**
 * Restores a persisted draft **over** a freshly seeded one, rather than in place
 * of it.
 *
 * A draft outlives the entity that wrote it — it sits in IndexedDB across
 * refreshes and deployments — so the two can disagree by the time it comes back.
 * Replacing the seed outright is how that disagreement becomes a bug the user
 * sees: a member added since the draft was written has no entry, reaches the form
 * engine as `undefined`, and its input flips from controlled to uncontrolled
 * mid-render. A member since removed goes the other way, surviving as a value
 * nothing renders and `reconstructEntity` cannot assign.
 *
 * So the seed decides the *keys* and the draft decides the *values*: a name the
 * entity no longer declares is dropped, and a name it declares that the draft
 * lacks keeps its seeded value.
 *
 * **A value is restored only in the shape its member can hold**, which is now
 * two shapes rather than one. A scalar takes a string; a `composition` takes a
 * readable row list. Anything else is dropped back to its seed — a member that
 * changed type between the write and the read, or a row list from a build that
 * did not carry keys, restores as the record's own value instead of as
 * something no editor can render. This is per member, so one unreadable entry
 * never costs the user the rest of the form.
 *
 * This is the shape guard at the one place the shape is actually known. The
 * store-level version check (`drafts-state.ts`) can only decide that a whole
 * generation of drafts is unreadable; it cannot know which members one entity
 * declares.
 */
export function restoreEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  seed: EntityDraft,
  persisted: EntityDraft | undefined,
): EntityDraft {
  if (persisted === undefined) return seed;

  const restored: EntityDraft = { ...seed };
  for (const descriptor of descriptors) {
    const value = persisted[descriptor.name];
    if (value === undefined) continue;

    if (descriptor.type === 'composition') {
      if (isRowDraftArray(value)) restored[descriptor.name] = value;
      continue;
    }
    if (typeof value === 'string') restored[descriptor.name] = value;
  }
  return restored;
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
 * members are skipped entirely; a relation is checked for presence but never
 * for format, since its draft value is a foreign key this side cannot resolve.
 *
 * Metadata is only the first of three rule sources; {@link composeEntityFormErrors}
 * is what layers a schema and the caller's own rules over this.
 */
export function validateEntityDraft(
  descriptors: readonly EntityFieldDescriptor[],
  values: EntityDraft,
  messages: EntityDraftMessages,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const descriptor of descriptors) {
    if (isNeverEdited(descriptor)) continue;

    if (descriptor.type === 'composition') {
      Object.assign(errors, validateComposition(descriptor, values, messages));
      continue;
    }

    const raw = readDraftString(values, descriptor.name);

    if (descriptor.required && raw.trim() === '') {
      errors[descriptor.name] = messages.required(descriptor.label);
      continue;
    }
    if (raw === '' || !hasCheckableFormat(descriptor)) continue;

    const message = formatMessage(descriptor, raw, messages);
    if (message !== undefined) errors[descriptor.name] = message;
  }

  return errors;
}

/**
 * The metadata rule for one filled scalar draft value, or `undefined` when it
 * passes.
 *
 * Extracted so a row's cell is judged by the **same** rule as a record's field.
 * Two copies is how a child's `number` member would quietly start accepting
 * something its master's would reject.
 */
function formatMessage(
  descriptor: EntityFieldDescriptor,
  raw: string,
  messages: EntityDraftMessages,
): string | undefined {
  if (descriptor.type === 'number' && Number.isNaN(Number(raw))) {
    return messages.number(descriptor.label);
  }
  if (descriptor.type === 'date' && Number.isNaN(new Date(raw).getTime())) {
    return messages.date(descriptor.label);
  }
  if (
    descriptor.type === 'enum' &&
    descriptor.enumValues &&
    !descriptor.enumValues.includes(raw)
  ) {
    return messages.option(descriptor.label);
  }
  return undefined;
}

/**
 * The rules an owned collection carries, at both of its levels.
 *
 * **`required` on the collection means "at least one row"** — the only thing a
 * master can assert about a collection it owns, and a genuinely different fact
 * from `required` on a child member, which is per row. Conflating the two would
 * make an order with three lines, one of them blank, indistinguishable from an
 * order with none.
 *
 * A row's own members are judged against the child's descriptors and reported at
 * `items[2].quantity`, so the grid can put the message in the cell that caused
 * it. Read-only child members are skipped for the reason they always are: no
 * editor exists for them, so no rule the user could satisfy applies.
 */
function validateComposition(
  descriptor: EntityFieldDescriptor,
  values: EntityDraft,
  messages: EntityDraftMessages,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const rows = readRowDrafts(values[descriptor.name]);

  if (descriptor.required && rows.length === 0) {
    errors[descriptor.name] = messages.required(descriptor.label);
    return errors;
  }
  if (descriptor.childType === undefined) return errors;

  const columns = editableChildColumns(
    describeChildColumns(descriptor.childType),
  );

  rows.forEach((row, index) => {
    for (const column of columns) {
      if (isNeverEdited(column)) continue;

      const raw = row[column.name] ?? '';
      const path = rowFieldPath(descriptor.name, index, column.name);

      if (column.required && raw.trim() === '') {
        errors[path] = messages.required(column.label);
        continue;
      }
      if (raw === '') continue;

      const message = formatMessage(column, raw, messages);
      if (message !== undefined) errors[path] = message;
    }
  });

  return errors;
}

/**
 * The error-map key an issue belongs to — the **whole** path, not its head.
 *
 * It used to read `issue.path?.[0]`, which was right while every member was a
 * scalar and wrong the moment one held rows: `['items', 2, 'quantity']`
 * collapsed to `'items'`, so a rule about the third line's quantity reported
 * itself against the collection and the grid had no way to know which cell it
 * meant. Joining instead produces `items[2].quantity`, which is the key
 * `validateComposition` already writes — so a schema rule and a metadata rule
 * address the same cell the same way and `composeEntityFormErrors` can merge
 * them.
 *
 * A one-segment path still yields exactly the head, so no existing rule changes
 * meaning.
 */
function issueFieldName(issue: StandardSchemaV1Issue): string | undefined {
  const path = issue.path;
  if (path == null || path.length === 0) return undefined;

  const segments = path.map(segment => {
    const raw =
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? segment.key
        : segment;
    return typeof raw === 'number' ? raw : String(raw);
  });

  return joinFieldPath(segments);
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
  values: EntityDraft,
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
  values: EntityDraft;
  messages: EntityDraftMessages;
  schema?: StandardSchemaV1;
  translateIssue: (message: string, field: string | undefined) => string;
  validate?: (values: EntityDraft) => Record<string, string>;
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
