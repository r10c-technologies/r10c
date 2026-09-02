# 38. Master-detail: a record and the rows it owns, edited in one write

- Status: Accepted
- Date: 2026-09-02

## Context

[ADR 0034](./0034-composition-metadata.md) gave an entity a way to say it owns a
collection — `@accessor({ type: 'composition', childType: () => OrderItem })` —
and built the persistence on both sides: `serializeEntity` writes owned rows as
plain child objects, `deserializeSingleEntity` rebuilds them through the child's
own accessors. It deliberately stopped there and named the rest as **#110's**.

### Measured: the metadata exists and nothing can edit it

`ProductOrder.items` is declared, persisted, and unreachable. A `composition`
descriptor arrives at `EntityForm` like any other, is classified as a relation,
and falls through to the read display, where `CellValue` renders
`t('value.rowCount', { count })` — "3 filas". There is no way to make it four.

### Measured: four residuals, each a defect rather than a gap

ADR 0034's own Residuals section hands this record a list, and reading the code
back confirms every item is a rule that is stated and then not applied:

| Where                                             | What it says                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `use-entity-form.helpers.ts` `issueFieldName`     | reads `issue.path?.[0]`, so `['items', 2, 'quantity']` collapses to `'items'`           |
| `use-entity-form.helpers.ts` `hasCheckableFormat` | excludes `composition`, so a child's `required` and `number` are metadata nothing reads |
| `reconstruct-entity.ts` `isWritableScalar`        | excludes `composition`, so rows never leave the draft                                   |
| `EntityDraft.ts`                                  | `Record<string, string>`, which no list of rows fits                                    |

The fourth is the one that orders the rest: a row cannot be keyed, focused or
addressed before the server has seen it, and every other decision here depends
on what a row's identity is.

### Measured: a live render loop, found by widening the draft

Making a composition seed its rows surfaced a fault that had nothing to do with
compositions. `useEntityForm` re-seeds whenever its `entity` changes identity,
and a caller that builds the record inline — which the hook's own tests do, and
a page reasonably might — re-seeds on **every render**. While every seeded value
was a deterministic string this was invisible: the draft was a new object with
identical contents, and the form engine settled. A freshly minted random row key
makes the contents differ every pass, and React stops the render loop with
`Maximum update depth exceeded`. That is a hang, not a test artifact, and it is
what decision 2 is shaped by.

## Decision

### 1. The draft holds two shapes, and the type says which two

`EntityDraft` becomes `Record<string, EntityDraftValue>` where
`EntityDraftValue = string | readonly EntityRowDraft[]`. A scalar still drafts
as the string a native input round-trips; a `composition` drafts as its rows.

**Not `JsonValue`**, though ADR 0032 licensed that and `DraftsState.drafts` is
already typed so. Two reasons, and the second is not a preference. `JsonValue`
would say more than is true — a member holding anything else has no editor, no
coercion and no restore rule, so `reconstructEntity` would carry it through and
the serializer would write it. And `JsonValue` is **recursive**, while TanStack
Form derives a field-path type from the value it is handed: a draft typed that
way makes that derivation unbounded and the build fails with `Type instantiation
is excessively deep and possibly infinite`. A row is a flat string map, so this
union has a bottom.

**Not flattened into path keys** (`items[0].quantity` as a top-level draft
entry), which is the shape that would have made the error map work for free.
`restoreEntityDraft` layers a restored draft over a freshly seeded one and lets
**the seed decide the keys**; a row count is not derivable from the entity, so
every flattened row key would be missing from the seed and dropped on restore.
The workspace would silently lose every line on refresh, which is the exact
failure autosave exists to prevent.

### 2. A row's key is `$key`, and a seeded one is deterministic

`ROW_KEY = '$key'`, carried **inside** the row so it survives the JSON round trip
attached to the row it identifies — a parallel array re-introduces the index
identity this exists to avoid. `describeChildColumns` **throws** on a child
declaring that name rather than reserving it silently: a member of the same name
would be overwritten by the key, so the row would re-key on every keystroke, drop
focus mid-word, and address another row's errors.

The two ways a key is minted are different on purpose:

- a row the record supplied takes `seededRowKey(index)` — `row-0`, `row-1` —
  because seeding is not a one-time event and a random key there is the render
  loop measured above. Positional is safe _here_ precisely because it describes
  the record rather than the live list: re-seeding the same record yields the
  same draft;
- a row the user adds takes `newRowKey()`, a UUID, which can never collide with
  that shape. Once anything is added or removed, the keys already in the draft
  are carried through untouched.

The key never reaches the wire. `reconstructChild` drops it, and there is no
guard for that — the walk is driven by `describeChildColumns`, which has already
thrown on such a member, so a guard would be unreachable code standing in for an
invariant that is enforced.

### 3. Two identities, two jobs: `$key` for React, an index path for errors

An error's key is `items[2].quantity`. `issueFieldName` joins the **whole**
issue path instead of taking its head; a one-segment path still yields exactly
the head, so no existing rule changes meaning.

Rows are keyed one way and errors another, which looks like an inconsistency and
is not. A Standard Schema issue can carry only a **positional** path, so an index
is the only thing a schema-authored rule can produce — and if the metadata rules
addressed a cell by row key while the schema addressed it by index,
`composeEntityFormErrors` could not merge them and the grid would find neither.
The index being stale after a removal is harmless _here_ and nowhere else: the
form re-runs its whole validator on every edit (`revalidateLogic`), so no index
outlives the keystroke that invalidated it. React keys cannot be recomputed that
way, which is why they are the minted key.

### 4. `required` means two different things, one level apart

On a **child member** it is per row: a line's `sku` must be filled. On the
**collection member** it is `rows.length > 0` — the only thing a master can
assert about a collection it owns. Conflating them would make an order with three
lines, one of them blank, indistinguishable from an order with none.

Child members are otherwise judged by the same `formatMessage` a record's fields
are, extracted for exactly that reason: two copies is how a child's `number`
would quietly start accepting what its master's rejects.

### 5. The write path is a second pass, not a widened scalar walk

`isWritableScalar` goes on refusing `composition`. `reconstructEntity` gains
`applyEntityComposition`, which runs after the scalar walk and rebuilds each row
through `reconstructChild` — zero-argument construction, assignment through
setters, the same `coerceFieldValue`. Keeping the walks separate means a
`composition` is written by exactly one piece of code, and that code cannot be
reached with a string.

A member whose draft entry is **unreadable is skipped, not cleared**. A draft
predating the member, or one restored from a build that did not carry row keys,
must leave the record's rows as they were rather than emptying them — a data loss
the user never asked for and cannot see. An explicitly empty list _is_ a value and
is written: that is a user who removed every row.

"One write" needs nothing new: the rows ride out on the master's own serialized
document, which ADR 0034 already taught the serializer to produce.

### 6. `EntityForm` renders the grid itself, below every field

An entity declaring an owned collection gets an editable grid with **no
entity-specific component**, which rules out a slot the caller passes. The form
partitions its resolved fields: scalars stay in the field stack, and every
`composition` with a `childType` becomes a full-width block rendered after it —
**whatever `order` it declared**. That is a partition rather than an ordering
hint, because a grid sitting between two labelled inputs reads as a field, and it
is not one; it is a second record list.

A `composition` that named no child stays in the field stack and reads as its row
count, exactly as before this control existed — an honest "some rows" rather than
an empty table implying there are none.

`assertLinkSourcesAreEditable`'s composition branch **stays**. A picker looks up
records that already exist; owned rows never do.

### 7. It is not `EntityTable`, and the reason is structural

`EntityTable` is a _server_ listing: pages, RSQL filtering and sorting, column
personalization, an `EntitySelection` union, a bulk bar, a card pivot. A detail
grid has none of those and cannot have them — its rows are local, unsaved, and
unqueryable by construction, since ADR 0034 makes a collection member never
`filterable`. Sharing the organism would mean each of those features growing a
"detail" branch. The two share the `Table` **atoms**, which is the level they
actually have in common.

### 8. Inline cells, and `Enter` is free because the form is not a `<form>`

Each cell is a `FieldControl` — the same descriptor→input map the form uses — so
a child's `enum` gets a select and its `date` a date input with no code in the
grid. `Tab` walks a row and crosses into the next; `Enter` in the **last row**
appends one and lands focus in its first cell.

Bound to the row rather than to its last cell, which is what it looks like it
should be: the last _column_ is whatever the child declared last, and a
`readonly` member there renders a disabled input that never receives a key — so
the binding would exist and be unreachable on exactly the entities that have a
computed column.

That binding is available at all only because `EntityForm` renders a `<Card>`
with a `<button onClick>` Save. Inside a real `<form>`, `Enter` in a text input
submits, and appending a row would be fighting the browser for the key. **Wrapping
the form in a `<form>` element would break this**, which is worth knowing before
someone does it for accessibility reasons.

### 9. One live region, not one per cell

A failing cell carries `aria-invalid` and points at its own message with
`aria-describedby`; the grid carries a single `role="alert"` summary above it.
A live region per cell announces the whole grid on every keystroke, and a message
that lives only in the cell is unreachable when the failing row is scrolled out —
which is the case #110 names as the requirement.

### 10. Reorder is not built, and totals are the caller's

**Reorder**: nothing in the metadata distinguishes a child whose order carries
meaning (invoice lines) from one where it does not (stock movements). Inventing
`orderable: true` here would be a declaration with one guess behind it.

**Totals**: an aggregate cannot be derived from metadata. Summing
`OrderItem.amount` is wrong — minor units, and several currencies once a basket
spans vendors — and summing `quantity` across offerings means nothing. The grid
takes a `footer` slot and invents no arithmetic.

**The create case needs nothing.** Rows live in the draft and go out with the
master's first write, which is precisely why the child has no id and why no
client key crosses the wire.

## Consequences

- Every form in the product now runs on a widened draft. Nothing that edits only
  scalars changes behaviour, but the type no longer lets a call site assume a
  string: `readDraftString` is the one read, and four hand-written rebuilds
  (`configuration-form`, `user-single-page`, `use-entity-link-sources`,
  `applyEntityLinks`) now go through it.
- The grid declares `isLoading`, so `loading-contract.spec.ts` requires a
  `Loading` story of it automatically — the gate ADR-less #108 left behind
  caught this control on its first run.
- `FieldControl` gained `aria-labelledby` / `aria-describedby` / `aria-invalid`
  pass-through. A cell has no label of its own: the column header is the label
  and the row is the subject.
- A composition's rows are validated for the first time, so an entity that
  declared `required` on a child member will start rejecting drafts it used to
  accept. That is the declaration finally being applied.
- There is **no fleet host to exercise this on**. `ProductOrder.items` is the
  only composition in the repo and the `order` slice is `planned`, so Storybook
  and the specs carry the control until M3 promotes it.

## Alternatives considered

- **Flatten rows into `items[0].quantity` draft keys.** It buys a working error
  map for free and keeps `EntityDraft` a string map. Rejected because
  `restoreEntityDraft` lets the seed decide the keys, so every row entry would be
  dropped on restore and autosave would lose the lines it exists to protect.
- **Type the draft as `JsonValue`.** ADR 0032 licenses it and the persisted store
  already uses it. Rejected: it permits shapes with no editor and no coercion,
  and its recursion makes TanStack Form's field-path derivation unbounded.
- **Address rows and errors both by `$key`.** Rejected: a Standard Schema issue
  carries a positional path and nothing else, so a schema rule could not produce
  such a key and the two rule sources would address the same cell differently.
- **Build on `EntityTable`.** It buys column personalization and the card pivot.
  Rejected — see decision 7; every server-listing feature would grow a detail
  branch for rows that are local and unqueryable.
- **A card pivot below `md`, matching `EntityTable`.** Rejected: stacked cards
  destroy the Tab-across-a-row story that makes the grid usable, and the `Table`
  atom already scrolls inside its own container. #110 calls a detail grid "the
  least card-pivotable thing in the system" and that reading held up.
- **An expanding row or a side panel.** Both handle a wide child better and pivot
  cleanly. Rejected: each costs a click before the first keystroke, and operator
  efficiency here is the keyboard story.
- **Derive the total by summing the numeric columns.** Rejected: it is wrong for
  money in minor units and meaningless across mixed currencies or units, and a
  plausible-looking wrong total is worse than none.

## Residuals

- **Reorder**, and the `orderable` metadata that would express it.
- **Nested composition** — a child owning its own collection. `reconstructChild`
  is one level deep and `editableChildColumns` drops such a member rather than
  rendering a cell that promises an edit that never lands.
- **SQL persistence of embedded collections** is still absent
  (`make-sql-repository.ts`); a composition persists in Mongo only. Unchanged by
  this record.
- **`linkCollection` still has no editor** (#26). Association and composition
  stay different problems with different controls.
- **A seeded row key is positional**, so a record whose rows are reordered
  server-side between two loads re-keys them. Harmless today because a re-seed
  replaces the draft anyway; it would matter if seeding ever became incremental.

## Relationship to other records

Builds on [ADR 0034](./0034-composition-metadata.md), whose Residuals section
names this work by issue number, and on
[ADR 0032](./0032-what-may-live-in-an-autosaved-draft.md), which set the rules a
draft is held to and anticipated this widening. It also depends on
[ADR 0035](./0035-entity-actions-selection-and-bulk.md) only for where a form's
actions sit, which is unchanged. **Supersedes nothing and amends nothing** — every
decision in 0032 and 0034 stands, and this record only fills the gaps they left
open deliberately.
