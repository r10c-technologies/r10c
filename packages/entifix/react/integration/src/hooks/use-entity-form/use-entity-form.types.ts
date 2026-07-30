import type {
  Entity,
  EntityConstructor,
  EntityLinkSelection,
  StandardSchemaV1,
} from '@r10c/entifix-ts-core';

/** The whole form value as strings — the shape native inputs round-trip. */
export type EntityFormValues = Record<string, string>;

export interface UseEntityFormOptions<TEntity extends Entity> {
  /** Metadata source; fields and their validation rules derive from it. */
  entityConstructor: EntityConstructor<TEntity>;
  /** The record being edited; seeds the initial draft. Omit to create. */
  entity?: TEntity;
  /**
   * A draft to seed from instead of the record — how a workspace restores an
   * autosaved, half-finished edit. Wins over `entity` when present.
   */
  initialValues?: EntityFormValues;
  /**
   * A Standard Schema (Zod, Valibot, ArkType — anything exposing `~standard`)
   * for the rules metadata cannot express: regex, min/max, cross-field.
   *
   * Authored against the **string draft**, so it coerces (`z.coerce.number()`)
   * rather than expecting typed values. Each message is a catalog key
   * (`validation.minLength`), resolved against the `controls` namespace with the
   * literal as its fallback — a rule written in one language would otherwise
   * reach the user untranslated. An issue with no path becomes `formError`.
   *
   * Synchronous rules only: validation runs in a synchronous pass, so an async
   * schema throws rather than silently passing. Put asynchronous checks — a
   * uniqueness lookup, say — behind {@link UseEntityFormOptions.validate}.
   */
  schema?: StandardSchemaV1;
  /**
   * Extra validation beyond the metadata and schema rules, returning a
   * field-name → message map. Applied last, so it wins on conflict.
   */
  validate?: (values: EntityFormValues) => Record<string, string>;
  /** Called with the draft once it passes validation. */
  onSubmit: (values: EntityFormValues) => void | Promise<void>;
}

export interface UseEntityFormResult {
  /** The current draft. Feed straight into `EntityForm`'s `values`. */
  values: EntityFormValues;
  /** Field-name → message, surfaced only after a submit attempt. */
  errors: Record<string, string>;
  /**
   * The message that belongs to no single field — a cross-field schema rule.
   * Feed into `EntityForm`'s `formError`, which has nowhere else to show it.
   */
  formError?: string;
  /** Feed into `EntityForm`'s `onFieldChange`. */
  setField: (name: string, value: string) => void;
  /**
   * The instances behind the relation ids the draft holds — seeded from the
   * record's already-materialized links and extended by every pick.
   *
   * Pass to `applyEntityLinks` at submit: the draft alone cannot express an
   * embedded relation, because an id is not an entity. It is a cache, so a
   * missing entry costs the embedded shape and never the relation itself.
   */
  links: EntityLinkSelection;
  /**
   * Feed into `EntityForm`'s `onLinkChange`. Records the picked instance and
   * writes its id into the draft, which stays the serializable source of truth.
   */
  setLink: (name: string, entity: Entity | undefined) => void;
  /**
   * Validate, then submit when clean. Feed into `EntityForm`'s `onSubmit`.
   *
   * Fire-and-forget for the caller, but the validation pass it starts settles on
   * a later tick — a test asserting on `errors` afterwards has to await, not
   * just `act`.
   */
  submit: () => void;
  /** True once any field has been edited away from its seed. */
  isDirty: boolean;
}
