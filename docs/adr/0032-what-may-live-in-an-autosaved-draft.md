# 32. What may live in an autosaved draft

- Status: Accepted
- Date: 2026-09-01

## Context

The workspace's headline feature is continuous autosave: a tab holds a
half-finished edit, and a refresh brings it back. It is built and it works —
`useDraftsState` persists a per-address draft through `createJSONStorage` into
IndexedDB, and `WorkspaceShell` rehydrates it before any URL effect runs.

Nothing states what a draft may **contain**, how it behaves when the shape it
was written under stops existing, or whose it is. Three things queued behind
this each widen the draft and would re-derive those answers separately:
master-detail rows with client-side keys for unsaved children, the wizard's
multi-step state across several entities, and the optimistic transaction id the
UI reconciles on reconnect.

### The relation sidecar, measured

The issue that opened this recorded the defect as "relations are silently
dropped on restore". Half of that is true, and the true half is smaller than it
reads — which matters, because the obvious fix is aimed at the wrong thing.

- **The draft never held instances.** `EntityCrudDraft` is `EntityLinkDraft` is
  `Record<string, string>`, and `EntityCrudForm` emits `form.values` and nothing
  else. The `EntityLinkSelection` sidecar lives in a `useState` inside
  `useEntityForm` and dies with the page, by design.
- **The label already re-resolves.** `useEntityLinkSource` runs a lookup
  whenever it holds an id and no instance — that is the restored-draft case, and
  it is what makes a restored picker show "Acme" rather than `brand-1`. That
  query returns the **whole target**; the hook read one property off it and
  discarded the rest.
- **What is actually lost is the wire shape.** On a restored draft
  `applyEntityLinks` took its `picked === undefined` branch and wrote the `id`
  shape onto a member the entity declares `linkSerialization: 'embedded'`. Two
  saves of the same unchanged form, one before a refresh and one after, put
  different things on the wire.
- **It is latent.** No entity in `packages/business` declares a `type: 'link'`
  accessor, and none declares `embedded`. Every relation in the tree today is a
  bare foreign key, which is exactly what ADR-era note "a picker also edits a
  bare foreign key, and that is the normal case now" describes.

### Two defects that are not latent

**Nothing is versioned.** Neither persisted store passed `version`, so a draft
written under an older shape was restored blind. The consequence is worse than a
crash, because it is silent: `initialValues` went straight to the form engine's
`defaultValues`, so a member added since the draft was written arrived
`undefined` and its input flipped from controlled to uncontrolled mid-render.

**Nothing is scoped.** The database is `r10c-workspace` and the keys were the
literals `tabs` and `drafts`. IndexedDB is a property of the browser profile, not
of the session, so two accounts on one machine shared both: the second saw the
first's open tabs and restored their unsaved edits. A draft is keyed by a
record's address, a record id is tenant-scoped, and a draft written under one
organization and restored under another would be submitted into the wrong
tenant.

## Decision

### 1. A draft is JSON round-trippable, period

No class instances, no `EntityLink`, no `Date`, no `Map`, no `undefined`. This is
not a style preference: a draft is written through `createJSONStorage`, so a
value that is not JSON does not degrade — it comes back as something else, and
nothing reports it.

The rule is written where it can be checked, in two halves:

- **Compile time.** `JsonValue` in `entifix-ts-core`, and
  `DraftsState.drafts: Record<string, JsonValue>` where it used to be
  `Record<string, unknown>`. `useDraft<TDraft extends JsonValue>` pushes the same
  constraint out to every call site.
- **Restore time.** `mergeDrafts` runs `isJsonValue` over each restored entry and
  drops the ones that fail. Per entry, not all-or-nothing: one draft written by a
  build that predates this rule must not take the rest of the workspace's drafts
  with it.

`isJsonValue` is structural rather than a `JSON.stringify` round trip, because a
round trip is the wrong test in both directions — a cycle throws there, and a
`Date` survives it while being precisely what must be rejected.

**`UiPreferencesState` is deliberately not held to this.** It is the other
persisted client store and it writes through IndexedDB's **structured clone**,
which does preserve a `Date` and a `Map`. The two contracts differ, and a type
describing one must not be reused for the other.

One sharp edge worth recording because the compiler's message does not explain
it: a draft type must be declared as a `type`, never an `interface`. TypeScript
gives an interface no implicit index signature, so even
`interface Draft { name: string }` fails the constraint with "Index signature for
type 'string' is missing".

### 2. The sidecar is refilled from the id, not persisted

The draft stays ids-only. What changes is that the instance the link source
already fetched is carried out — `EntityLinkSource.selected.entity` beside
`selected.label` — and handed back to the form through a new `hydrateLink`.

`hydrateLink` is separate from `setLink` because a lookup landing is not a user
pick: it writes the sidecar only, never the draft value, so it cannot dirty a
form nobody has touched, and it never overwrites an entry already there (a pick
in flight is newer than a lookup that started before it).

With the sidecar refilled, `applyEntityLinks` no longer needs a silent fallback,
so it does not have one: an `embedded` member holding an id with no instance
**throws**. Same posture as `assertSearchable` — break the developer rather than
put the wrong thing on the wire. To keep that unreachable in practice,
`EntityForm` disables Save while any link source is still resolving, which is the
honest state anyway: the form is still assembling itself.

**Rejected: a `{ id, label }` projection inside the draft.** It widens the draft
to carry a label the source already resolves, and it still cannot reconstruct an
`embedded` relation, because that needs the whole target. It is more persisted
state buying nothing.

### 3. A version mismatch discards

Both stores carry an explicit `version` and a `migrate` that returns the empty
state. A draft is an unfinished edit, not a record: losing one costs a retype,
while migrating it blind risks submitting values whose meaning changed. For tabs
it is starker — a restored tab whose `param` no longer resolves renders the
dead-link fallback, so a drifted snapshot is a strip of broken tabs rather than
an error anyone can act on.

Written out rather than left to zustand's default, which also discards but logs
`State loaded from storage couldn't be migrated since no migrate function was
provided` — an error message for a decision made on purpose.

The version covers the **envelope**, and it cannot do more: the store holds
`JsonValue` and only the form that wrote a draft knows which members it should
have. That half is `restoreEntityDraft`, which layers a restored draft **over** a
freshly seeded one — the seed decides the keys, the draft decides the values — so
a member the entity no longer declares is dropped and one the draft never held
keeps its seeded value instead of arriving `undefined`.

### 4. Drafts are scoped by user and active organization

The storage key gains a scope: `drafts:<userId>:<activeOrganizationId>`, and
`tabs:` likewise. The organization is in the key and not only the user, because a
party may hold several memberships, switching re-mints the token, and a record id
is tenant-scoped.

It is resolved **server-side** — `WorkspacePage` reads the access cookie and
passes it down — because the session cookies are httpOnly and the browser cannot
derive it. The prop is **required**, so a host that forgets it fails to compile
rather than quietly handing the next account the previous one's drafts. A visitor
whose principal cannot be read gets an explicit `anonymous` scope rather than the
unscoped key, since falling back to the bare key is the exact failure being
prevented.

Applied through `persist.setOptions` in the effect that already drives
rehydration, **before** the read: the key decides whose state comes back, so
setting it afterwards would restore the unscoped set first.

⚠️ **IndexedDB is not a confidentiality boundary.** Anyone holding the browser
profile can read every key in the object store, and they hold the session cookie
too. The scope prevents an accidental cross-account restore; it does not prevent
anything from being read. It follows that deriving it from **unverified** token
claims is safe — the same reasoning `navRoles` already records: forging the
cookie shows you a different set of your own browser's drafts, and every request
behind a restored draft is still authorized by the service that answers it.

## Consequences

- A draft can no longer hold anything a JSON round trip would change, and the
  compiler says so at the call site rather than the user discovering it.
- A restored draft keeps its embedded relations, and a form cannot be saved
  half-resolved.
- The `embedded` wire shape can no longer flip between two saves of the same
  form. Nothing in the tree declares `embedded` today, so this changes no
  behaviour now and forecloses the bug before the first entity does.
- Changing `DRAFTS_VERSION` or `TABS_VERSION` throws away every persisted
  workspace on the next load, deliberately.
- Two accounts on one browser profile no longer share tabs or drafts. Existing
  local drafts are orphaned by the key change, which is correct and costs a
  retype; no migration is written, because there is no production
  (`CLAUDE.md`, "nothing runs in production").
- `WorkspaceShell` gained a required prop, so a second host mounting it must
  resolve a scope. That is the intent.

## Alternatives considered

- **A store factory plus a React context**, so each scope gets its own zustand
  store. The textbook shape, and it would have rewritten every existing workspace
  spec for no additional correctness: both stores already carry
  `skipHydration: true` and `WorkspaceShell` is the only thing that rehydrates
  them, so re-pointing the singletons at the right key before the read achieves
  the same separation.
- **Hashing the scope into an opaque key.** It would keep a user id out of a
  devtools panel and buys nothing: whoever can open that panel already holds the
  session cookie.
- **Clearing IndexedDB on sign-out.** Not rejected on the merits — see the
  residual below.
- **Blocking submit only for `embedded` members**, rather than while any source
  resolves. A descriptor's serialization is not what makes an in-flight lookup a
  bad moment to submit, and a form that saves half-resolved is confusing whichever
  shape it writes.

## Residuals

- **Storage is not cleared on sign-out.** Scoping already prevents the accidental
  restore, and there is nothing to hook: the workspace's own sign-out menu item
  has no handler at all, and `POST /api/auth/logout` is a server route that
  cannot touch IndexedDB. Worth revisiting with the sign-out UI.
- **`UiPreferencesState` is unscoped**, defaulting to the `r10c-ui` namespace for
  everyone. It holds column layout and sidebar collapse; its `namespace` argument
  is the seam if that changes.
- **No per-entity draft migration.** The version handles the envelope and
  `restoreEntityDraft` handles member drift. A draft that survives a _semantic_
  change to a member it still names is not detectable, and a per-entity schema
  version is not yet worth its weight.
- **To-many relations are still not editable**, so `linkCollection` has no draft
  question yet.

## Relationship to other records

Supersedes nothing and amends nothing. It settles a question the workspace
design left open, and it is what the master-detail, wizard and optimistic-
transaction work builds on rather than each answering separately.
