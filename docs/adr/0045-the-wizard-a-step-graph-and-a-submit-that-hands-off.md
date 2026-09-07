# 45. The wizard: a step graph, a draft above the forms, and a submit that hands off

- Status: Accepted
- Date: 2026-09-07
- Amends: [ADR 0042](0042-the-workspace-address-is-the-taxonomy-serialized.md)
  (the third address segment gains a second meaning: a step, for `wizard:`).

## Context

[#111](https://github.com/r10c-technologies/r10c/issues/111) designed the wizard
and [#128](https://github.com/r10c-technologies/r10c/issues/128) asked for it.
`wizard` is the last of [ADR 0033](0033-the-screen-taxonomy.md)'s four screen
types with nothing behind it, and the gap is legible from three directions at
once — [ADR 0044](0044-the-command-palette.md)'s own source table has a row
reading "Wizards — do not exist (#128)".

### Measured: `wizard` is an enum value with a translated label and nothing else

A repository-wide search finds the word in exactly five places, and every one of
them is a declaration waiting for a consumer:

| Where                                              | What is there                              |
| -------------------------------------------------- | ------------------------------------------ |
| `business-ts-authz/values/screen-type.ts`          | the `ScreenTypes` member and its label key |
| `entifix-ts-i18n` `es`/`en` `shell.ts`             | `'Asistentes'` / `'Wizards'`               |
| `shells-next-common/workspace/tab-kind.ts`         | a doc comment reserving the kind by name   |
| `back-office/group-by-screen-type.spec.ts`         | a test fixture                             |

So the sidebar already knows how to render an **Asistentes** tier, the address
grammar already parses `wizard:`, and the palette's nav source already turns a
nav item into a command. What is missing is a control and a screen — not any of
the plumbing around them.

### Measured: the flow #111 names cannot be built, and the reason is not the UI

#111 motivates the wizard with "a wizard creating an offering + stock + channel
spans **three stores in three slices**", and concludes the submit must be a saga
hand-off. Both halves are right and the example is unbuildable:
[ADR 0022](0022-v1-marketplace-module-boundaries.md) has `stock` and `sales` as
**`planned`** slices with no deployment, and
[ADR 0039](0039-multi-step-sagas-are-orchestrated.md) records in its own text
that "the multi-step engine is not written" — `SagaDefinition` has zero
occurrences in any source file.

What does exist is one entity opted into a tracked write:
`TransactionCommand.type` is the literal `'create'`, and
`create: 'command'` is declared for `ProductSpecification` and nothing else. So
the honest first wizard is a single-slice one, and the decision this record has
to get right is not *how to orchestrate* but **what shape the ending takes so
that it does not change when the orchestrator lands**.

### Measured: `useEntityForm` cannot currently answer "did that pass?"

`submit` is `() => void` over `void form.handleSubmit()`. It resolves nothing and
exposes no validity, and `revalidateLogic` keeps a pristine form quiet until the
first submit — which is exactly the behaviour a wizard wants from "Siguiente" and
exactly the signature it cannot gate on. The hook's own spec already carries the
consequence as a warning: a test asserting on `errors` afterwards has to await,
not just `act`.

## Decision

### 1. Steps are a graph, and the way back is the path taken

A step declares `next(state) => stepId`. There is no `previous(state)`, and that
asymmetry is the decision rather than an omission: a branch's inverse is
**ambiguous once an earlier answer changes**, so a computed one walks the user
back through a path they were never on. `WizardState` carries a `history` stack
— the steps actually visited, in order — and Back pops it.

Retrofitting branching onto an array index is the alternative, and it is a
rewrite rather than an extension: "step 3 depends on step 1's answer" is
unsayable when the successor is `index + 1`.

### 2. Step values are a discriminated union, and `EntityDraft` is not widened

```ts
type WizardStepValue =
  | { readonly kind: 'form'; readonly values: EntityDraft }
  | { readonly kind: 'selection'; readonly ids: readonly string[] }
  | { readonly kind: 'choice'; readonly option: string }
  | { readonly kind: 'none' };
```

A wizard's state is heterogeneous by construction — a form step drafts strings, a
table step holds a set of ids — and the tempting move is to widen `EntityDraft`
to hold both. That is wrong for the reason `EntityDraft.ts` already records at
length: the draft is handed to TanStack Form, whose field-path type derivation is
**unbounded over a recursive type**, and `ADR 0038` widened it once already to
exactly two shapes with that constraint in view. Wizard state sits *above* the
form rather than inside it, so it is JSON in its own right and the entity draft
is left alone.

⚠️ A selection step stores **`readonly string[]`, never a `ReadonlySet`**. A
`Set` serializes to `{}` silently, which is the identical fault
[ADR 0035](0035-entity-actions-selection-and-bulk.md) named for the wire — and a
wizard's state goes through `createJSONStorage` on every keystroke, so it would
be hit far more often here than there.

### 3. The draft lives above the forms, and each step gets a view onto it

`useWizard` owns one `WizardState` and persists it as one value.
`draftStoreFor(stepId)` returns an **`EntityDraftStore`** — the port
[ADR 0032](0032-what-may-live-in-an-autosaved-draft.md) already defined — viewing
`state.steps[stepId].values`.

This is what makes Back safe, and it is safe *whether or not a step unmounts* —
which matters because steps **do** unmount. A form step calls `useEntityForm`
itself, and React's hook count must stay fixed, so N form steps cannot be N hook
calls in one component. Holding the draft above the form removes the question
entirely: the alternative, keeping every step mounted and hidden, buys the same
property at the cost of mounting every step's queries and pickers on the first
render of the wizard.

⚠️ `save` must be **referentially stable per step id**. `useEntityForm` writes
from an effect keyed on it, so a fresh identity per render turns every render
into an IndexedDB write — the trap `useEntityDraft` documents and the reason it
is memoised.

### 4. "Siguiente" is the step's own submit, so `submit()` learns to answer

`UseEntityFormResult.submit` widens:

```ts
submit: () => Promise<boolean>;   // resolves true iff the submit actually ran
```

`form.handleSubmit()` already returns a promise, and `onSubmit` already fires
only when validation passed, so both halves of the answer existed and were being
discarded. Every current caller ignores the return value and a function returning
a value is assignable where `void` is expected, so nothing else changes.

Two alternatives were available and are both larger. An **imperative handle**
threaded through a `ref` makes the step's validity reachable but adds a second
way to talk to a form. **Lifting `composeEntityFormErrors`** out of the hook lets
the wizard validate the step directly, and is worse than larger: it makes the
wizard validate a draft it does not own, and duplicates the merge order
(metadata → schema → callback) that has one home today.

A form step is therefore its own component. It calls `useEntityForm`, and
registers `{ validate: () => submit() }` with the wizard through context.

### 5. A summary step is required, and the definition fails at load

Fiori's wizard ends in a read-only summary and #111 records that it is not
optional — it is how a person checks a long flow before committing it.
`assertWizardDefinition` therefore throws on a definition whose terminal step is
not the declared summary, as well as on an unknown `next` target and an
unreachable step.

**Load time, not step time**, which is [ADR 0035](0035-entity-actions-selection-and-bulk.md)'s
reasoning applied unchanged: a wizard missing its last step must fail on the
first render of *any* surface, not on the render of the step nobody reached —
otherwise the failure arrives at the end of the longest flow in the product.

`next` is a function of state, so reachability is not decidable by analysis. It
is checked by **exercising** the definition across its declared `choice` options,
which covers every branch this grammar can express; a `next` that reads a form
value cannot be enumerated, and that limit is stated here as a review rule rather
than papered over with a check that only appears to hold.

### 6. A stepper is not a tablist

An ordered list (`<ol>`/`<li>`), `aria-current="step"` on the active one, focus
moved to the step heading on advance, and each step's completed/error state
announced rather than conveyed by colour alone.

`TabStrip` is the nearest-looking thing in the repo and is the **wrong**
precedent: it is `role="tablist"`, which tells a screen reader that the panels
are siblings the user may choose between, and a wizard's steps are ordered and
gated. There is no in-repo prior art for a stepper, and no a11y addon or axe to
catch a regression, so the roles are asserted in the control's own spec.

### 7. The address carries the step, and the third segment gains a second meaning

`wizard:product-setup:identity` as a tab address, `?step=identity` on the plain
route. `screenAddress` and `parseScreenPayload` already produce and accept this
shape — what changes is what the third segment *means*. It is documented as "the
record being viewed"; it becomes **the position within the screen**: a record for
`master`, a step for `wizard`.

That is a modelling call rather than a rename, which is why it is recorded here
and amended onto ADR 0042 rather than edited in quietly.

The control stays router-free: `activeStep` is controlled and `onStepChange` is a
prop, the same rule that made `hrefFor` a prop. URL synchronisation is the
shell's job.

**Neither `TABS_VERSION` nor `DRAFTS_VERSION` bumps.** ADR 0042 bumped both
because it *renamed* prefixes, which left stored tabs resolving to nothing. This
adds a prefix: every stored `master:` tab and every existing draft resolves
exactly as before, and discarding them would be a cost paid for no correction.

### 8. A wizard launcher is not a use-case verb

ADR 0035's nine cells all resolve to an action **on records** — the binding
decides whether the payload is one record or a selection. A launcher acts on
nothing; it opens a screen. The only handler a `collection:context-independent`
verb reaches is `onBulkUseCase`, whose contract is
`(key, selection) => Promise<BulkOutcome[]>`, so routing a navigation through it
would hand a per-row outcome contract something with no rows.

So a wizard is reached the way a screen is reached: its **Asistentes nav item**,
the **command palette** (free — the palette's nav source already produces a
command per visible nav item), and a **toolbar affordance on the list it starts
from**, which is the mitigation ADR 0033 named for a wizard sitting far from the
records it operates on.

### 9. The submit is a hand-off, and that is what survives the orchestrator

`onFinish` returns **before the write is terminal**. The wizard renders a pending
state driven by the caller; the pending set and the SSE settlement of
[ADR 0043](0043-the-optimistic-mutation-contract.md) carry it the rest of the
way, exactly as `makeEntityCrud`'s `handleSave` already does — including its rule
that a still-pending write **does not clear the draft**.

Today that hand-off is one tracked `create` command. When ADR 0039's engine
lands it becomes a saga id, and the control does not change, because it never
knew the difference: it hands off and shows what the caller tells it. A wizard
that awaited a resolved write would have to be rewritten for that engine, which
is the whole reason this is stated as a decision rather than left to the first
implementation.

## Alternatives rejected

- **Steps as an array with an index.** Simplest, and #111 rules it out for a
  reason that is not aesthetic: the first realistic wizard already branches, and
  converting an index to a graph later touches every step, the stepper, the back
  button and the persisted state at once.
- **Keep every step mounted, hidden.** Makes Back trivially safe without a draft
  above the form. Rejected because it mounts every step's data on the first
  render — a table step's listing and two pickers' lookups for a wizard the user
  may abandon on step one — and because the draft has to exist anyway for resume.
- **Widen `EntityDraft` to hold step values.** Would let one type serve both.
  Rejected on the recursion constraint in §2, and because it puts wizard-shaped
  values into the type `reconstructEntity` walks.
- **A `wizard` use-case verb.** Would make the launcher discoverable through the
  metadata that already drives every other affordance. Rejected in §8: the
  contract on the other side is per-row outcomes, and a tenth cell invented for
  navigation would make the nine-cell map mean two things.
- **Await the write on Finalizar.** The obvious ending, and the one ADR 0043 was
  written against: it re-introduces the spinner that resolves, and it is the
  behaviour that must change when the orchestrator arrives.

## Consequences

- `UseEntityFormResult.submit` returns `Promise<boolean>`. No call site changes;
  the existing specs may stop working around the settle-on-a-later-tick trap.
- `EntityCrudOptions` gains `toolbar?: ReactNode`. `EntityTable` already sorts an
  `EntityTableToolbar` child into its own slot, and `makeEntityCrud` already
  passes `columns` through as children — so the affordance worked before this,
  filed under the wrong option name.
- `ProductSpecification.code` gains `resetOnClone: true`. Correct independently
  of the wizard: a copy must not carry a unique code.
- New copy: `controls.wizard.*` for the control, `shell:marketplaceAdmin.wizard.*`
  for the first wizard's own names.
- The step graph is in **core**, framework-free, for `command-matching.ts`'s
  reason: `entifix-react-controls` and `entifix-react-integration` are both
  `entifix:react` and may not import each other, so anything both need meets
  below them.
- A wizard is **not** generated. ADR 0033 already recorded that `makeEntityCrud`
  builds `master` and only `master`, and Fiori reached the same split — every
  floorplan generated except the wizard and the initial page. A second wizard is
  a second definition, not a second generator.

## Related

- [ADR 0033](0033-the-screen-taxonomy.md) — the four screen types; `wizard` is
  the fourth, and this is what fills it.
- [ADR 0042](0042-the-workspace-address-is-the-taxonomy-serialized.md) — the
  address grammar this amends.
- [ADR 0032](0032-what-may-live-in-an-autosaved-draft.md) — the draft port a step
  reuses, and the JSON constraint the wizard's own state is held to.
- [ADR 0035](0035-entity-actions-selection-and-bulk.md) — the selection model a
  table step holds, and the nine cells §8 declines to add a tenth to.
- [ADR 0038](0038-master-detail-the-rows-a-record-owns.md) — the last widening of
  `EntityDraft`, and why §2 does not repeat it.
- [ADR 0039](0039-multi-step-sagas-are-orchestrated.md) — the engine §9 is shaped
  for and does not require.
- [ADR 0043](0043-the-optimistic-mutation-contract.md) — the pending set and the
  settlement that carry the hand-off.
