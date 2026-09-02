# 35. Entity actions: where a verb appears, and what a bulk action acts on

- Status: Accepted
- Date: 2026-09-02
- Amends: [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)

## Context

ADR 0026 gave a use case two independent axes — `binding` (`entity` |
`collection` | `unbound`) and `placement` (`context-dependent` |
`context-independent` | `determining`) — and stated the intent plainly: "one
vocabulary, three surfaces". It then built one surface. The other two were named
in its Consequences as unblocked-but-not-built, and the collection half never
arrived.

### Measured: four of the nine cells were dropped in silence

`entity-form.tsx` filtered its descriptors:

```ts
// entity-form.tsx, before this record
useCases.filter(d => d.binding === 'entity' && d.placement !== 'context-dependent');
```

Two of the nine `binding × placement` cells rendered. The rest were dropped with
no error, no warning and no log. That failure mode is the reason this record
exists at all: a verb in a dropped cell is **declared, granted, exported, and
passes every `@r10c/slices` invariant** — the source scan checks that a verb has
one implementation, that its entity declares it, that some role grants it, and
that its class is reachable from the package barrel. All four pass. The verb
simply never appears, which reads to its author as a permission problem and
sends them to look at `ROLE_PERMISSIONS`, which is correct.

### Measured: the collection side had nothing to render into

`EntityTable` had no selection of any kind. `hasRowAction` was
`onSelect !== undefined || hrefFor !== undefined`, and `onSelect` is the _link
picker's_ single-pick — it sets one form value and accumulates nothing. No
checkbox column, no select-all, no row menu, and no `metadata` prop, so the
table could not have seen a declared verb even if one had existed.

None had. Two `@useCase()` classes existed repo-wide, both `entity`-bound, both
on `UserIdentity`. So `binding: 'collection'` was a vocabulary member with no
declaration, no surface, and no test.

### Measured: the machinery had one consumer

`user-single-page.tsx` was the only place in the repo passing `metadata` to
anything. `makeEntityCrud` — which generates every catalog page — passed none,
so every generated screen still rendered the pre-0026 behaviour: Save and Delete
unconditional, no declared verbs. The action model was built, shipped, and
reaching one screen.

## Decision

### 1. Placement decides the surface; binding decides the payload

The nine cells, exhaustively, in one module (`ui/actions/action-surfaces.ts`) so
that no surface re-derives them:

| binding      | placement             | surface                        |
| ------------ | --------------------- | ------------------------------ |
| `entity`     | `context-independent` | form header                    |
| `entity`     | `determining`         | form footer                    |
| `entity`     | `context-dependent`   | **row overflow menu**          |
| `collection` | `context-dependent`   | **bulk bar**                   |
| `collection` | `context-independent` | **table toolbar**              |
| `collection` | `determining`         | **invalid — throws at render** |
| `unbound`    | any                   | command palette (#129)         |

`collection` + `determining` throws rather than being dropped. A determining
action _finalizes a page_ — it is an object page's footer — and a list screen
has no page to finalize; this is Fiori's own rule, and it is the one cell with
no honest home. The throw names the verb and states the fix. It fires on the
**first render of any surface**, not only the one that would have shown it,
which is the same reasoning `assertLinkSourcesAreEditable` already follows: a
check that only runs on the screen someone was already looking for the verb on
is a check that runs after the bug is reported.

A spec asserts every cell is _decided_ — mapped or rejected — so a tenth cell
cannot be added silently.

### 2. Two select-alls, two state shapes, never one

```ts
export type EntitySelection<TEntity extends Entity> =
  | {
      mode: 'ids';
      ids: ReadonlySet<EntityId>;
    }
  | {
      mode: 'matching';
      filtering?: FilterGroup<TEntity>;
      total: number;
      excluded: ReadonlySet<EntityId>;
    };
```

"Select all on this page" is a list of ids the browser already holds. "Select
all 3.200 matching the filter" is a **filter expression the server evaluates** —
the set is by definition larger than the page, so there is nothing to enumerate.

Written as one shape with an optional flag, the second quietly becomes the
first, and an action that reads as "the 25 rows I can see" runs over every row in
the store. So they are two members of a discriminated union, and the escalation
is a **separate affordance carrying the count** — never a widening of the header
checkbox. `excluded` is what makes the second mode usable rather than
all-or-nothing: everything matching, minus the two rows the operator knows
about.

`total` is carried rather than derived because only the server knows it, and the
count is the affordance: "Retirar 3.200 marcas" is a different sentence from
"Retirar", and it has to be read _before_ the confirmation.

**The wire form is arrays.** A `Set` serializes to `{}` — silently — so a
`matching` selection sent raw arrives with its exclusions gone and acts on rows
the operator deliberately removed. `EntitySelectionWire` and
`readWireSelection` name the two shapes separately; the reader rejects anything
that is not a selection rather than defaulting, because defaulting to `ids`
would act on nothing and defaulting to `matching` would act on everything.

### 3. A bulk result is per row, never one notice

```ts
export interface BulkOutcome {
  id: EntityId;
  ok: boolean;
  code?: string;
}
```

Forty selected, three fail. A single notice lies in both directions: as a
failure it hides the thirty-seven that were written, and as a success it hides
the three that were not — which is the worse half, because the operator walks
away believing the work is done. Both counts are always stated and every failure
is named with its own reason.

`code` is an error **code**, resolved through the shared `errors` catalog — the
same vocabulary a service's `{ error, code }` body renders from, so a new
failure reason is translatable and `@r10c/i18n-check` fails the build on one the
catalog lacks.

A retry re-runs the **failures only**, as an `ids` selection built from the
outcomes — never the original selection, which would redo the successful rows
and, for a `matching` selection, re-resolve a filter whose answer has just
changed underneath it. The selection **survives the action** until explicitly
cleared, because the operator's next act is usually exactly that retry.

A bulk run is **not one transaction**. The rows share no invariant — retiring
Sony neither depends on nor constrains retiring Philips — so atomicity would
only convert a partial success into a total failure. Each row is attempted
independently and the effect does not fail: a failed _row_ is data, not an error.

### 4. Clone stays off the descriptor

ADR 0026 closed `UseCaseDescriptor` against per-verb payloads and named this
exact case. Honoured: the members a copy resets are
`@accessor({ resetOnClone: true })`, and `cloneEntityDraft` is draft-in,
draft-out so it composes with a form whose state is a string draft an autosave
round-trips (ADR 0032).

The identity member is cleared **without consulting the descriptors**.
`describeEntityColumns` drops `hidden` members, and a form hiding its id is the
ordinary case — every generated catalog page does it — so a descriptor-driven
sweep would leave the id in place on exactly the forms a Clone button appears
on, and the "copy" would save over the original.

### 5. Selection is controlled from above the table

Like `filtering` and `sorting` already are, plus one reason of its own: a
selection must survive pagination, and the page owns the pager. Held inside the
table it would be reset by the very navigation used to add to it.

`onSelect` (the picker) and `selection` are **mutually exclusive** and wiring
both throws. A picker chooses one value for a form member; offering a set there
would hand many rows to a field holding a single reference.

### 6. The first collection verb is `retire`, and it is `super-admin`'s

`ProductBrand` and `ProductCategory` gain a `status` (`active` | `retired`).
Retiring is **not deleting**, and that distinction is the reason the member
exists: a `ProductSpecification` in another slice's store holds a bare
`brandId`/`categoryId` with nothing enforcing the reference (ADR 0022), so
removing the row leaves every offering classified under it pointing at nothing.
Retiring keeps the record resolvable for what already points at it while taking
it out of the pickers that would add more. It is reversible.

Granted to `super-admin` only, and **written as a literal beside `*:*:*`
although the wildcard already covers it**. The wildcard is the catch-all for
capabilities that do not exist yet; it is not a substitute for naming a verb
that does, and a wildcard satisfying `@r10c/slices`' "every declared verb is
granted somewhere" check makes that check vacuous for exactly the verbs most
worth checking. Not `admin`'s: `catalog-reference` is operator-owned, and a
tenant role that could retire a brand would take a classification away from
every other vendor using it.

The **entityKey** segment is wildcarded; the **action** segment is not. ADR
0026's recorded residual stands — no role but `super-admin` wildcards an action,
so a new verb still escalates to nobody.

### 7. The proxy carries the caching contract

`createServiceProxyRoute` rebuilt every response as a fresh body, which dropped
`ETag`, `Cache-Control` and `Vary` and forwarded no `If-None-Match`. ADR 0026
predicted the consequence and it was live: `$metadata` computes and hashes a
permission-filtered document per request, and a validator that never reaches the
service means it can never answer `304`.

`Vary` is the half that is **correctness rather than tuning**: the document
differs per caller, and one cached without `Vary: Cookie, Authorization` can be
served to a different principal. Now forwarded and passed back, with `304`
answered as a body-less `304`. A short allow-list, not a copy of every header —
the upstream's `content-length` describes its own body, and carrying it onto a
rebuilt response is how a proxy serves a truncated payload.

## Consequences

- Every generated catalog page now reads `$metadata`, so Save and Delete are
  filtered against the caller's real grants rather than always rendered. This is
  **not** a security change — the route guard was and remains the boundary.
- Rendering an action is asynchronous where rendering a field is not; that cost
  was accepted in ADR 0026 and is paid here through `LoadingBoundary`.
- A row's selection checkbox carries an `aria-label` and never an `id`: both
  pivots are always in the DOM, so an id would be emitted twice per row.
- `BULK_SELECTION_CAP` (500) bounds one request. Past it the work is a saga
  (#121), which is not built, so the cap is deliberate and visible rather than a
  silent truncation.
- A bulk request resolves a `matching` selection through the **same**
  `loadUCFactory` the listing uses, so the rows an action touches are the rows
  the filter shows — one query path, one RSQL allowlist.

## What this does not decide

Long-running bulk as a saga (#121 names it; it needs #135–#137), the wizard
(#128), nested error addressing for detail rows (#122), and `unbound` verbs,
which reach the command palette in #129 and have no surface until it exists.
