# 42. The workspace address is the taxonomy serialized

- Status: Accepted
- Date: 2026-09-06
- Area: frontend
- Read when: addressing a workspace tab — `master:<key>[:<id>]` is one grammar, and both version constants bump when it changes
- Revised: 2026-09-07 by [ADR 0045](0045-the-wizard-a-step-graph-and-a-submit-that-hands-off.md)
  — the third segment is the position within the screen: a record for `master`,
  a step for `wizard`.
- Amends: [ADR 0033](0033-the-screen-taxonomy.md) (its `TabKind` consequence
  predicted a rename; this is a collapse, and the difference matters).

## Context

ADR 0033 recorded that `catalog:` / `entity:` / `system:` "become type-derived
(`master:`, `operation:`, …) when #141 makes the workspace registry derive from
the nav", and deferred it because "renaming them by hand now is work done twice".

Doing it revealed the record had the shape wrong. `catalog:` addressed a **list**
and `entity:` addressed a **record**, and both are Definiciones. So type-derived
prefixes are not a rename of three kinds into three others; they are a collapse
of three into **one**, whose payload carries an optional id.

What the old grammar cost was measured. The list address and the record address
were each spelled out at several call sites that had to agree by hand — the
registry's `match`/`toParam`, `useTabEntityNav`'s two builders, the draft key in
the editor tab (whose own comment called itself "the third spelling"), and the
`workspace:` literals in three nav fragments. Two of those spell the _same_
string for two different purposes: the tab address and the key its autosaved
draft is filed under. A drift between them detaches a tab from its own draft,
silently.

The registry itself was two hand-written const maps against the 28 entities
ADR 0022 fixes for v1, and a key missing from either failed quietly: absent from
the list map, a tab opened onto nothing; absent from the editor map, the
sidebar's open-in-workspace control did nothing at all, which is #133.

## Decision

### One grammar: `<screenType>:<key>[:<id>]`

`master:product-brand` is the list, `master:product-brand:abc123` is one record.
`system:configuration` becomes `master:configuration`. Three `TabKind`s become
one, because the list and the record are not different kinds — they are the same
screen with and without a record, which is what the optional id says.

`screenAddress` and `parseScreenPayload` are the only two functions that know the
grammar. `TabRegistry` is untouched: it is generic over `kind` strings and never
encoded these three itself.

### The builder lives in `business-ts-authz`

Beside `screen-type.ts`, not in `shells-next-common`. Not for a boundary reason —
`shells-next-common` is `shell:base` and every consumer may reach it — but
because the address **is** `ScreenType` serialized, and because every `nav.ts`
(marketplace-admin, auth, system-management) is a plain data module importing only
this package. Putting the builder anywhere else means a nav file pulls in a
React-and-zustand package to spell a string.

### An untyped section cannot be addressed, and that is the mechanism

`screenAddress` takes a `ScreenType`. The account surface deliberately declares
none (ADR 0033), so an address for it **cannot be constructed**. The exclusion is
structural rather than a branch somebody has to remember not to add.

### The registry derives; the host still composes

One `CatalogSurface` declaration per catalog entity now produces the nav item, the
workspace address, the list tab, the record tab and the search source. The five
hand-maintained lists become one.

Which screens a host offers as tabs stays the host's decision — a second host
mounting the same shells may want a different set — but _how_ one is addressed
and what renders it no longer is. Configuration remains a hand-written registry
entry and earns it: its screen is not generated and it has no record tab at all.

### Both persisted stores bump

`TABS_VERSION` and `DRAFTS_VERSION` go to 2. Both already discard on drift, so no
migration logic changes.

Skipping either does not fail loudly, which is the reason to say so here: a stale
`catalog:` tab resolves against the new registry as a **dead link**, so the
workspace comes up holding a strip of broken tabs rather than empty. Confusing
rather than broken, and therefore easy to ship by accident.

## Consequences

- The catalog's nav moves into `shells-next-marketplace-admin`, mirroring
  `AUTH_NAV` and `SYSTEM_MANAGEMENT_NAV`, and `apps/back-office-app/src/lib/nav.ts`
  becomes concatenation. Its `CATALOG`/`CATALOG_REFERENCE` domain constants are
  deleted — `permissionForEntity` derives the same strings from `@entity()`.
- The copy moves with it: `app:admin.nav.{catalog,products,brands,categories}`
  become `shell:marketplaceAdmin.nav.*`, because an `app:` key is a lint error
  outside `apps/`. `chrome.tsx`'s breadcrumb map follows.
- `EntityCrud` carries `entityLabelKey` and `entityPluralKey`, read off
  `@entity({ labelKey, pluralKey })` rather than rebuilt from the key — a second
  place that knows how a catalog subtree is laid out is a second place to fix
  when one moves. `EntityCatalogKey` now requires both in the catalog, so a
  missing one fails at the call site that generates the screens.
- **User administration can be a workspace tab.** It could not before, and not
  for want of an address: `UserDetailPage` read its id from `useParams`, which
  resolves to nothing under `/workspace`, so an address alone would have opened a
  form for a record with no id. It takes the same `slug` / `onSaved` / `draft`
  props every generated single view does — #131's seam, applied to a hand-written
  page — and so it also gains autosave, the dirty marker and the close
  confirmation.
- ADR 0033's `TabKind` consequence is superseded in shape: read this record for
  what the prefixes became.

## Alternatives considered

- **Keep `catalog:` and `entity:` and only derive the maps.** Smaller, and it
  needs no version bump. Rejected because it leaves the two grammars and their
  several spellings in place, which is the half that fails silently — and the
  next screen type to arrive would have had to pick a prefix with no rule.
- **One kind per type _and_ per shape** (`master-list:`, `master-record:`).
  Explicit, and it removes the optional id. Rejected: it doubles the kinds for a
  distinction the payload already carries, and the id is what a record tab is.
- **Derive the address from `basePath` instead of the entity key.** Tempting,
  since the route is what a person sees. Rejected because they legitimately
  differ — `product-specification` lives at `/catalog/product` — and the registry
  keys on the entity, so the route would have to be reversed back into a key.
- **A `migrate` that rewrites old addresses.** Would preserve open tabs across
  the change. Rejected under the repo's no-back-compat rule: nothing runs in
  production, and a migration shim for a local dev fleet is dead code to maintain
  at every later step.

## Residuals

- Only `master` is populated. `operation:`, `wizard:` and `report:` get the same
  builder for free, but nothing has exercised them, so the first non-`master`
  screen is where the grammar is actually tested.
- A generated list opened as a tab still uses plain `href`s for its rows, so
  clicking one leaves the workspace. True before this change and unchanged by it.
- `MARKETPLACE_ADMIN_CRUDS` erases its three concrete entity types to
  `EntityCrud<Entity>`. Nothing downstream needs them — the registry renders
  components and titles tabs — but the erasure is a cast, not an inference.
