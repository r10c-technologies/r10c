import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';

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
   * Extra validation beyond the metadata-derived rules, returning a
   * field-name → message map. A Standard Schema can be adapted to this shape,
   * which keeps rich rules (regex, min/max, cross-field) available without the
   * hook depending on a schema library.
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
  /** Feed into `EntityForm`'s `onFieldChange`. */
  setField: (name: string, value: string) => void;
  /** Validate, then submit when clean. Feed into `EntityForm`'s `onSubmit`. */
  submit: () => void;
  /** True once any field has been edited away from its seed. */
  isDirty: boolean;
}
