import type {
  EntifixError,
  Entity,
  EntityConstructor,
  EntityFieldDescriptor,
  EntityLinkSource,
  EntityMetadataDocument,
} from '@r10c/entifix-ts-core';
import type { ReactNode } from 'react';

/** Whether the form shows values as text (`read`) or as inputs (`edit`). */
export type EntityFormMode = 'read' | 'edit';

/**
 * The whole form value, held as strings — the shape native inputs round-trip.
 * Typed reconstruction into a domain entity happens in the per-entity wrapper at
 * submit, never inside this agnostic form.
 */
export type EntityFormDraft = Record<string, string>;

/** What a custom edit control for one field is handed. */
export interface EntityFieldRenderContext {
  draft: EntityFormDraft;
  value: string;
  setField: (name: string, value: string) => void;
  /** The id the field's label points at — put it on your control. */
  id: string;
}

/**
 * A field as the form finally renders it: the metadata descriptor plus the
 * per-field overrides a caller supplied through an `<EntityField>` slot.
 */
export interface EntityFormField<
  TEntity extends Entity,
> extends EntityFieldDescriptor {
  /** Replaces the default edit control. */
  render?: (context: EntityFieldRenderContext) => ReactNode;
  /** Replaces the default read display. */
  readRender?: (entity: TEntity | undefined) => ReactNode;
  /** True when the field has no backing entity member (slot-only field). */
  virtual?: boolean;
}

export interface EntityFormProps<TEntity extends Entity> {
  /** Metadata source. Fields, labels and types derive from its accessors. */
  entityConstructor: EntityConstructor<TEntity>;
  /** The record being viewed/edited. The read display and, in a wrapper, the
   *  initial draft both come from it; omit for a create form. */
  entity?: TEntity;

  /** The current draft. The form is controlled — a host (the `useEntityForm`
   *  hook or a `useState`) owns this and updates it via `onFieldChange`. */
  values?: EntityFormDraft;
  /** Called when one field changes. */
  onFieldChange?: (name: string, value: string) => void;

  /**
   * A search/browse source per reference, keyed by accessor name. A `link` field
   * with a source gets the full editor; one without keeps its read-only display,
   * which is what a form that only shows a relation still wants.
   *
   * A **`string`** field with a source gets the same editor, because a foreign
   * key whose target lives in another slice's store cannot be a typed `link` at
   * all and is a plain id member (ADR 0022). The editor does not know the
   * difference — it writes the target's id into the draft either way.
   *
   * A key naming any other member throws: `linkCollection` has no editor
   * anywhere yet, and a `boolean`/`enum`/`number`/`date` can never name another
   * record, so the entry could only be dropped — and a dropped source looks
   * exactly like a member the entity declared read-only.
   *
   * A registry rather than a slot per relation: the whole point is that an entity
   * declaring a reference needs no bespoke control. The sources are built by the
   * caller because fetching them is the integration layer's job, and this package
   * cannot reach it.
   */
  // A source's target is another entity entirely, so it cannot be expressed in
  // terms of `TEntity`; the input it feeds is instantiated per field anyway.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  linkSources?: Record<string, EntityLinkSource<any>>;
  /**
   * A relation was set or cleared. The instance travels alongside the id the
   * draft holds, so a host can remember it — an id alone cannot be written as an
   * embedded relation.
   */
  onLinkChange?: (name: string, entity: Entity | undefined) => void;

  /** Force a mode. Omit to let the form own it (with the built-in toggle). */
  mode?: EntityFormMode;
  /** Initial mode when uncontrolled. Defaults to `read` with an `entity`, else
   *  `edit` (a create form opens ready to type). */
  defaultMode?: EntityFormMode;
  onModeChange?: (mode: EntityFormMode) => void;

  /** Per-field validation messages, keyed by field name. */
  errors?: Record<string, string>;
  /**
   * A validation message that belongs to no single field — a rule spanning two
   * of them. Rendered above the actions, since no row can host it.
   */
  formError?: string;

  onSubmit?: (draft: EntityFormDraft) => void;
  onDelete?: () => void;

  /**
   * What this caller may do with the entity, as served by
   * `GET /api/<entity>/$metadata` and already filtered against the verified
   * principal (ADR 0026).
   *
   * **Optional, and absent means "as before".** Without it the form renders Save
   * and Delete exactly as it always has, so a call site that has not migrated is
   * unaffected. This is not a security control — hiding a button protects
   * nothing; the route guard does. It is what stops a screen offering an action
   * the service will refuse.
   */
  metadata?: EntityMetadataDocument;
  /** The document is still in flight; the action row renders as a skeleton. */
  isMetadataLoading?: boolean;
  /**
   * A declared use case was invoked, by its `key`. The form renders the button
   * and asks for confirmation where the descriptor says to; performing the act
   * is the caller's — the browser must never import a use-case class.
   */
  onUseCase?: (key: string) => void;

  isLoading?: boolean;
  isSaving?: boolean;
  isDeleting?: boolean;
  /** The failure of the last load/save, shown as an alert. */
  error?: EntifixError;

  /** Link to return to, rendered as a `Back` action. Omit to hide it. */
  backHref?: string;
  /** Heading for the card. Defaults to a generic label. */
  title?: ReactNode;

  /** Customization slots — see `entity-form-slots`. */
  children?: ReactNode;
}
