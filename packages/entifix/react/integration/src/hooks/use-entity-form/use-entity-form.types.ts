import type {
  Entity,
  EntityConstructor,
  EntityDraft,
  EntityDraftValue,
  EntityLinkSelection,
  StandardSchemaV1,
} from '@r10c/entifix-ts-core';

/**
 * Where an autosaved draft is persisted, as the form sees it.
 *
 * A **port**, because the store cannot be imported: `useDraft` and the zustand
 * store behind it are `layer:shell`, this package is `layer:entifix`, and
 * `@nx/enforce-module-boundaries` fails the build on the upward edge. Retagging
 * to make it legal would put an IndexedDB store under the framework layer, so
 * the shell implements this instead — `useEntityDraft` in `shells-next-common`
 * is the one adapter today.
 *
 * It lives here rather than in `entifix-ts-core`, and the asymmetry with
 * `EntityLinkSource` is deliberate: that port sits in core because
 * `entifix-react-controls` and `entifix-react-integration` are both
 * `entifix:react` and may not import each other, so they *had* to meet below
 * both. Nothing forces that here — `shells-next-common` already imports this
 * hook — so the port stays beside the options it joins.
 *
 * Everything it carries is JSON round-trippable, because a draft is written
 * through `createJSONStorage`
 * ([ADR 0032](../../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
 * `EntityDraft` is that guarantee's compile-time half.
 */
export interface EntityDraftStore {
  /**
   * The persisted draft, layered over the record's seed — how a workspace
   * restores an autosaved, half-finished edit.
   *
   * It wins on *values*, never on *keys*: a member the entity no longer declares
   * is dropped and one the draft never held keeps its seeded value, so a draft
   * written under an older shape cannot leave a field uncontrolled. See
   * `restoreEntityDraft`.
   */
  readonly draft?: EntityDraft;
  /**
   * Persist the draft. Called on every edit away from the seed.
   *
   * Must be referentially stable across renders: the hook writes from an effect
   * keyed on it, so a new identity each render turns every render into a write.
   */
  save(draft: EntityDraft): void;
  /**
   * Discard the persisted draft.
   *
   * **The hook never calls this.** A draft is spent when the write *commits*,
   * and the hook does not know whether it did — it neither fetches nor saves.
   * The host that owns the mutation calls it on success. Naming it on the port
   * anyway is what stops each host re-deriving the address it would clear by.
   */
  clear(): void;
}

export interface UseEntityFormOptions<TEntity extends Entity> {
  /** Metadata source; fields and their validation rules derive from it. */
  entityConstructor: EntityConstructor<TEntity>;
  /** The record being edited; seeds the initial draft. Omit to create. */
  entity?: TEntity;
  /**
   * Where to persist this form's draft, so a half-finished edit survives a
   * refresh. Omit and the form is ephemeral — which is what a plain route wants,
   * and why autosave is opt-in rather than a flag a host can set wrong.
   */
  draft?: EntityDraftStore;
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
  validate?: (values: EntityDraft) => Record<string, string>;
  /** Called with the draft once it passes validation. */
  onSubmit: (values: EntityDraft) => void | Promise<void>;
}

export interface UseEntityFormResult {
  /** The current draft. Feed straight into `EntityForm`'s `values`. */
  values: EntityDraft;
  /** Field-name → message, surfaced only after a submit attempt. */
  errors: Record<string, string>;
  /**
   * The message that belongs to no single field — a cross-field schema rule.
   * Feed into `EntityForm`'s `formError`, which has nowhere else to show it.
   */
  formError?: string;
  /**
   * Feed into `EntityForm`'s `onFieldChange`.
   *
   * A scalar takes a string; a `composition` takes its list of rows, the one
   * member with no lossless string form.
   */
  setField: (name: string, value: EntityDraftValue) => void;
  /**
   * The instances behind the relation ids the draft holds — seeded from the
   * record's already-materialized links, extended by every pick, and refilled
   * from a resolved id by {@link UseEntityFormResult.hydrateLink}.
   *
   * Pass to `applyEntityLinks` at submit: the draft alone cannot express an
   * embedded relation, because an id is not an entity. It is not persisted — a
   * restored draft arrives with ids and no instances, which is what
   * `hydrateLink` exists to repair.
   */
  links: EntityLinkSelection;
  /**
   * Feed into `EntityForm`'s `onLinkChange`. Records the picked instance and
   * writes its id into the draft, which stays the serializable source of truth.
   */
  setLink: (name: string, entity: Entity | undefined) => void;
  /**
   * Record an instance resolved from an id the draft already held — the restore
   * path, not a pick.
   *
   * Unlike {@link UseEntityFormResult.setLink} it writes only the sidecar, so it
   * cannot dirty a form the user has not touched. It also never overwrites an
   * entry that is already there: a pick in flight is newer than a lookup that
   * started before it.
   */
  hydrateLink: (name: string, resolved: Entity) => void;
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
