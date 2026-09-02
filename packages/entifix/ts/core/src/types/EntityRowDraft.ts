/**
 * The member a row draft carries its client-side identity in.
 *
 * A `composition`'s rows are editable before the record they belong to has ever
 * been saved, and the child is a **value** — `OrderItem` has no `id`, no domain
 * and no permission namespace
 * ([ADR 0034](../../../../../../docs/adr/0034-composition-metadata.md)). So the
 * only identity a row can have is one the browser mints, and it exists for
 * exactly two jobs: a stable React key, and stable focus across a re-render.
 *
 * `$` is not a legal first character for any member this repo declares, but that
 * is a convention rather than a rule, so `describeChildColumns` **throws** on a
 * child that declares this name instead of trusting it. A silent collision would
 * be a row whose key is overwritten by its own data — it would re-key on every
 * keystroke, lose focus mid-word, and address the wrong row's errors.
 */
export const ROW_KEY = '$key';

/**
 * One row of an owned collection, as a form holds it.
 *
 * Members are strings for the reason every draft value is a string — that is
 * what a native input round-trips — and the whole row is JSON, because the
 * workspace autosaves the master's draft through `createJSONStorage`
 * ([ADR 0032](../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md)).
 * The key rides **inside** the row rather than in a parallel array precisely so
 * that it survives that round trip attached to the row it identifies; a parallel
 * structure re-introduces the index identity this exists to avoid.
 *
 * {@link ROW_KEY} never reaches the wire: `reconstructChild` drops it when it
 * rebuilds the child, so the serializer never sees a member the entity does not
 * declare.
 */
export type EntityRowDraft = { [member: string]: string };

/**
 * Mints a key for a row the user has just added.
 *
 * `crypto.randomUUID` rather than a counter, because two drafts restored into
 * one session must not collide, and a counter that resets on reload would
 * re-issue keys a persisted draft is still using.
 */
export function newRowKey(): string {
  return crypto.randomUUID();
}

/**
 * The key of the *n*th row as the record supplied it.
 *
 * Deterministic, and that is load-bearing rather than tidy. Seeding is not a
 * one-time event: `useEntityForm` re-seeds whenever its `entity` changes
 * identity, and a caller that builds the record inline re-seeds on **every
 * render**. Minting a fresh random key there produces a draft that differs from
 * the last one on every pass, so the form engine sees its defaults change
 * forever and React stops with `Maximum update depth exceeded` — a live hang,
 * not a test artifact.
 *
 * Positional is safe *here* precisely because it describes the record rather
 * than the live list: re-seeding the same record yields the same keys, and once
 * the user adds or removes anything the keys already in the draft are carried
 * through untouched. A row added at runtime takes a {@link newRowKey} instead,
 * which can never collide with this shape.
 */
export function seededRowKey(index: number): string {
  return `row-${index}`;
}

/**
 * Whether a draft value is a usable list of rows.
 *
 * A restored draft is `JsonValue`, so a composition member can come back as
 * anything — a string written by a build before this existed, `null`, or an
 * array of the wrong shape. Every caller must ask before reading, and the answer
 * for a value that fails is an empty grid rather than a crash: an unreadable
 * draft is an unfinished edit, and `restoreEntityDraft` already discards those
 * per entry rather than losing the whole form.
 *
 * A row missing its {@link ROW_KEY} fails, deliberately. Minting one here would
 * hide the case where a row was written by something that does not know the
 * contract, and the missing key would then be minted afresh on every render.
 */
export function isRowDraftArray(value: unknown): value is EntityRowDraft[] {
  return (
    Array.isArray(value) &&
    value.every(
      row =>
        typeof row === 'object' &&
        row !== null &&
        !Array.isArray(row) &&
        typeof (row as Record<string, unknown>)[ROW_KEY] === 'string' &&
        Object.values(row as Record<string, unknown>).every(
          member => typeof member === 'string',
        ),
    )
  );
}

/** The rows a draft value holds, or an empty list when it holds none usable. */
export function readRowDrafts(value: unknown): EntityRowDraft[] {
  return isRowDraftArray(value) ? value : [];
}
