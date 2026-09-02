/**
 * A form's in-progress values, keyed by accessor name.
 *
 * Every value is a **string**, because that is what a native input round-trips
 * and because a workspace autosaves a draft through `createJSONStorage` — see
 * [ADR 0032](../../../../../../docs/adr/0032-what-may-live-in-an-autosaved-draft.md).
 * A member whose value is not a string reaches this shape through a lossless
 * string form or not at all: a `scalarCollection` drafts as a comma list, and a
 * `composition` has no string form, which is why its rows have no editor yet
 * (#122) rather than a lossy one.
 *
 * This alias exists in **one** place on purpose. The same structural type was
 * declared three times — `EntityFormValues` in the form hook, `EntityFormDraft`
 * in the form organism and `EntityLinkDraft` here in core — so widening the
 * draft to carry rows meant finding three declarations that nothing connects.
 */
export type EntityDraft = Record<string, string>;
