# Frontend

Everything about the client side: the agnostic **design system** (UI kit, layout
primitives, tokens, Storybook), the **workspace tabs + client data layer** the
marketplace-admin app is built on, and the **server-first storefront** that is
built on almost none of it. Backend/domain architecture is in
[ARCHITECTURE.md](./ARCHITECTURE.md); the entity framework the UI renders is in
[ENTIFIX.md](./ENTIFIX.md).

---

# Part 1 — Design system

The agnostic UI kit and the conventions for extending it. Two homes:

- **`@r10c/entifix-react-controls`** (`packages/entifix/react/controls`) — every
  **entity-agnostic** component: `ui/atoms`, `ui/molecules`, `ui/layout`,
  `ui/organisms`. Knows nothing about any domain.
- **`implementation/<domain>/react`** — **entity-tight** components. Empty today:
  every organism it held (`ProductTable`, `ProductForm`, …) was a pass-through
  whose only non-generic token was a class name, and `makeEntityCrud` derives
  those from metadata now. The layer is reserved for a component that is
  genuinely specific to one domain and cannot be derived.

The two metadata-driven organisms are **`EntityTable`** and **`EntityForm`**: both
build themselves from `describeEntityColumns` (see [ENTIFIX.md](./ENTIFIX.md)), so
listing or editing a new entity needs no bespoke component. `EntityForm` toggles a
**read** mode (values as text via `CellValue`) and an **edit** mode (inputs via the
`FieldControl` atom, the type→input inverse of `CellValue`); a relation gets the
two-mode editor below when the form is handed a source for it, and stays read-only
otherwise (an `<EntityField>` slot still overrides either). Both are
presentational — draft, errors and actions arrive as props — so the same form hosts
on a plain route and inside a workspace tab.

### `makeEntityCrud` — the pages, generated

`makeEntityCrud(Ctor, options)` (`@r10c/shells-next-common`) builds the list page
and the single-record page for one entity, and returns them as a **named
descriptor** — `entityConstructor`, `entityKey`, `basePath`, `ListPage`,
`SingleViewPage` — so a nav entry and a workspace `TabKind` can be derived from
the same object rather than restated in a const map.

It **cannot live beside the hooks**: it needs `EntityTable`/`EntityForm` from
`entifix-react-controls` and `useDataLoading`/`useEntityForm`/`useEntityRecord`/
`useEntityMutation`/`useEntityLinkSource` from `entifix-react-integration`, and
those two are both `entifix:react`, which is absent from its own allow-list. The
shell layer is the lowest place that can reach both — and it is also where
`useLocaleHref` and the `TabRegistry` already are.

Six things it cannot derive, and so takes as options: `basePath`, `catalogKey`,
which adapter holds the record's repository, which holds configuration,
`hiddenFields`, and `links`. Everything else — columns, inputs, labels, the
validation rules, the submit rebuild — comes from the entity's own accessor
metadata.

Three details worth not rediscovering:

- **The catalog key is a derived union, not a `string`.** `EntityCatalogKey` maps
  over the `entity` catalog and keeps only the keys carrying both
  `form.editTitle` and `form.newTitle`, so the title stays checked by `useT` with
  no `useTranslateKey` escape hatch — and a new reference entity cannot call the
  factory until its copy exists in both locales. The factory additionally asserts
  the key is the entity's own `@entity({ key })`; a drifted one would title the
  form after a different entity.
- **`links` is frozen at factory time**, which is what lets the sources be built
  in a loop at all. `useEntityLinkSources` carries the codebase's single
  `react-hooks/rules-of-hooks` disable, with the reason: the array is the same
  object on every render, so the hook count is fixed — the invariant the rule
  protects and the one it cannot see.
- **A hidden member still round-trips.** `hiddenFields` drops a member from the
  rendered fields, not from the draft, so a value the create transaction assigned
  (`ProductBrand.code`) survives an update that never showed it.

Styling foundation lives in **`@r10c/entifix-style`** (`packages/entifix/style`,
CSS-only): `tokens.css` declares the Utopia fluid scales, the layout tokens, and
the semantic colour **contract**; `presets/*` and app-local `themes.css` override
the contract values per palette. See [[design-system-theme]] in memory and
[ENTIFIX.md](./ENTIFIX.md).

The presets have one consumer outside the browser. `tools/zitadel-seed.mjs`
copies **aurora**'s and **midnight**'s four semantic colours
(`--color-primary`, `--color-surface`, `--color-content`, `--color-danger`) into
Zitadel's instance label policy, because the hosted login takes colours over an
API and cannot take CSS. Nothing enforces that copy — this package ships no TS
export a Node script could import — so changing one of those four in a preset
means changing the seed with it, and bumping `ZITADEL_SEED_REVISION`.

## The screen taxonomy — what shape a new screen takes

Four types, and they are the sidebar's **top tier**, above the domain
([ADR 0033](./adr/0033-the-screen-taxonomy.md)):

| Rendered         | Identifier  | The record came from | Lifecycle | Verbs        | Examples                                       |
| ---------------- | ----------- | -------------------- | --------- | ------------ | ---------------------------------------------- |
| **Definiciones** | `master`    | _you_ authored it    | none      | CRUD         | brand, category, courier, tipo de DTE, channel |
| **Operaciones**  | `operation` | a _process_ made it  | yes       | domain verbs | order, payment, settlement run, reservation    |
| **Asistentes**   | `wizard`    | guided, multi-step   | ends      | next/finish  | vendor onboarding, publish an offering         |
| **Consultas**    | `report`    | nothing — aggregate  | n/a       | read only    | commission reports, settlement summaries       |

`makeEntityCrud` is the generator for **`master`, and only `master`**. A screen
that is not Definiciones is not a gap in the generator — SAP Fiori reached the
same split independently: every one of its floorplans is metadata-generated
except the wizard and the initial page.

The rule that keeps the four from dissolving: **"publish" is an action on a
`master` screen, not a fifth type.** ADR 0026 gave every entity a way to declare
verbs, so treating a verb as grounds for promotion to `operation` promotes all of
them. A **worklist** ("orders awaiting me") is likewise not a type — it is an
`operation` screen with a default filter bound to the principal, and making it
one would put a record class in two nav places.

Three things worth not re-deriving:

- **The identifiers are English, the copy is Spanish, and three of the four
  differ.** `query` was unusable (RSQL, TanStack Query and `filterable` metadata
  all already mean something by it) and `assistant` reads as an AI agent, so the
  enum took `report` and `wizard`. `SCREEN_TYPE_LABEL_KEYS`, next to the enum in
  `business-ts-authz`, is the single place that reconciles them — the names are
  one vocabulary, and a second declaration site is the drift `nav.ts` was already
  merged once to stop.
- **`Definiciones`, not `Maestros`.** The ERP-standard word needs the ERP
  background to parse. `Catálogos` and `Referencias` are both out on collisions
  that already exist in this repo: "catálogo" is the product catalog, and
  `shell:storefront.category.sortByCode` already renders "Referencia" for a
  product's code.
- **`type` is optional, and exactly one section may skip it.** The account
  surface is not a group of administrative screens, which is the same reason none
  of its items carries a permission. A second untyped section means the taxonomy
  is missing a case, not that the field is loose.

`GuardedNavSection` carries the type, so **every contributing shell declares its
own** — that interface is the only layer a `layer:shell` package and a `layer:app`
both reach, and adding the tier is not an edit in the host. The nested rendering
itself is not built yet (#113, #123), and `TabKind`'s `catalog:`/`entity:`/
`system:` prefixes become type-derived when #141 makes the workspace registry
derive from the nav rather than restating it.

## Action surfaces — where a declared verb appears

A `@useCase()` carries two independent axes, `binding` and `placement`
([ADR 0026](adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
Their product is nine cells, and **every one is decided** in
`ui/actions/action-surfaces.ts` — mapped to a surface, or rejected with an error
that names the fix
([ADR 0035](adr/0035-entity-actions-selection-and-bulk.md)):

| binding      | placement             | surface                        |
| ------------ | --------------------- | ------------------------------ |
| `entity`     | `context-independent` | form header                    |
| `entity`     | `determining`         | form footer                    |
| `entity`     | `context-dependent`   | row overflow menu              |
| `collection` | `context-dependent`   | bulk bar                       |
| `collection` | `context-independent` | table toolbar                  |
| `collection` | `determining`         | **invalid — throws at render** |
| `unbound`    | any                   | command palette (#129)         |

The rules, each of them a defect that was live before it was one:

- **A cell no surface owns throws.** `EntityForm` used to filter to
  `binding === 'entity' && placement !== 'context-dependent'` and drop the rest
  in silence, which is the worst possible failure here: the verb is declared,
  granted, exported and passes every `@r10c/slices` invariant, so its author
  reads the absence as a permission bug and goes looking in `ROLE_PERMISSIONS`.
  The check runs on the first render of **any** surface, not only the one that
  would have shown the verb.
- **Four actions fit a row; twelve do not.** A surface renders its first four as
  buttons and folds the rest behind one overflow menu, in declaration order —
  the entity's author decided what matters by writing it first, and sorting by
  anything else reorders the row every time a verb is added.
- **Two select-alls, and they are different features.** "Select all on this
  page" is a list of ids; "select all 3.200 matching" is a filter the _server_
  evaluates. They are two members of a discriminated union, never one shape with
  a flag, and the escalation is a separate affordance carrying the count. The
  wire form is **arrays**: a `Set` serializes to `{}`, silently, and a selection
  whose exclusions evaporate acts on rows the operator removed on purpose.
- **A bulk result is per row.** Forty selected, three fail: one notice lies
  either way. Both counts are stated, every failure is named with an error
  **code** the `errors` catalog resolves, a retry re-runs only the failures, and
  the selection survives the action until cleared.
- **Clone is metadata, not a verb.** `@accessor({ resetOnClone: true })` names
  the members a copy drops; the id is always dropped, and **without consulting
  the descriptors** — `describeEntityColumns` skips `hidden` members, and every
  generated form hides its id, so a descriptor-driven sweep would leave it in
  place on exactly the forms a Clone button appears on.
- **A picker and a multi-selection are mutually exclusive**, and wiring both
  throws: a picker chooses one value for a field that holds one reference.

`EntityActions` is the slot for what metadata cannot describe, so a page never
has to render its action outside the card. Everything metadata _can_ describe
should be a `@useCase()` — that is what makes it permission-filtered,
translatable, and reachable from the command palette when #129 lands.

## Foundations: two scales, one contract

Spacing (`--spacing-3xs…3xl`) and type (`--text-step-xs…4`) keep **one set of
names** and take **different values per app** — the mechanism `--color-*`
already used, extended to measurement. It works because Tailwind emits these
utilities by reference (`.p-s { padding: var(--spacing-s) }`), so redefining the
custom property re-scales every existing call site and no component learns which
app it is in.

| Scale                            | Who             | Shape                                                                                  |
| -------------------------------- | --------------- | -------------------------------------------------------------------------------------- |
| fluid, `tokens.css` (default)    | marketplace-app | Utopia `clamp()` at an 18–20px prose base; interpolates with the viewport              |
| fixed, `presets/fixed-scale.css` | back-office-app | 4 / 8 / 12 / 16 / 24 / 32 / 48px; type fixed at 11 / 12 / **14** / 16 / 20 / 24 / 32px |

The preset changes nothing when imported — every rule is keyed to an attribute,
exactly like a palette is keyed to `[data-theme]`. An app opts in once:

```html
<html data-theme="aurora" data-scale="fixed" data-density="compact"></html>
```

**Density compacts spacing, never type.** `[data-density]` is a property of the
work, not of the viewport, which is why it is an attribute and not a media query
— it does not breach the no-media-query rule below. `2xl`/`3xl` are untouched
(page rhythm, not row density), and `[data-density-exclude]` opts a subtree out:
alerts, help panels and date pickers do not compact.

Each type step carries its own line-height and letter-spacing via Tailwind's
`--text-*--line-height` / `--text-*--letter-spacing`, so a size utility brings
its whole typographic setting with it.

Two layout tokens back the primitives:

- `--measure` — max line length (readability cap for `Center`).
- `--grid-min` — minimum card-column width for `Grid`.

**Typeface.** Inter (UI) and JetBrains Mono (ids, code, keys), loaded with
`next/font/google` in each app and exposed as `--font-inter` /
`--font-jetbrains-mono` at the front of `--font-sans` / `--font-mono`. The fonts
module is duplicated per app on purpose: `next/font/google` is a compiler macro,
and a workspace library ships as prebuilt `dist`, so the call would reach the
runtime unprocessed. **Three weights** — 400 / 500 / 600; `bold` is not in the
`Text` API. Tabular figures are not on the face (prose needs proportional ones);
`CellValue` applies `tabular-nums` for `number` and `date` members.

**Elevation is four named rungs** — `shadow-edge` ‹ `shadow-raised` ‹
`shadow-card` ‹ `shadow-overlay` — declared as plain custom properties with
hand-written utilities, **not** in `@theme`. Tailwind parses a themed shadow at
build time and inlines its color, so a palette redefining `--shadow-*` did
nothing (which is what every palette here was doing, in dead CSS); and a custom
`@utility` loses to a theme-generated one, so the size names could not be
reused. A palette now re-tints in one line with `--shadow-tint` /
`--shadow-strength`.

**One focus utility.** `focus-ring` on every interactive control — an `outline`,
so it follows `border-radius`, survives an ancestor's `overflow: hidden`, and
costs no layout. It matches `:focus-visible` **and** `[data-focus]`, because
HeadlessUI drives some controls with the attribute rather than native focus.
`--color-focus-ring` is its own token per palette, each measured against the 3:1
non-text contrast minimum.

Components **never** use raw colours or pixel gaps: they reference token
utilities (`bg-surface`, `text-content`, `gap-s`, `p-m`, `text-step-1`).
Tailwind is v4 **CSS-first** — no config file; tokens are declared via `@theme`
in `tokens.css`. The full specimen is Storybook → Foundations → Typography and
Tokens. See [ADR 0027](adr/0027-two-scales-a-density-mode-and-the-type-system.md).

## Layout: flex-first + one grid escape

Layout primitives follow [Every Layout](https://every-layout.dev): they lay
themselves out **intrinsically** with `flex-wrap` / `flex-basis` / `gap` — **no
media queries**. There is exactly **one** CSS-Grid escape hatch, `Grid`, for card
grids. Primitives live in `ui/layout/`:

| Primitive  | Purpose                                            | Key props                                                                     |
| ---------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Box`      | Padded, themed container                           | `padding`                                                                     |
| `Center`   | Centre + cap to a readable measure                 | `measure`, `gutters`, `intrinsic`                                             |
| `Cluster`  | Horizontal group that wraps                        | `gap`, `justify`, `align`                                                     |
| `Sidebar`  | Fixed side + fluid main, wraps when cramped        | `side`, `gap` (+`'none'`); `Sidebar.Side{width}` / `Sidebar.Main{contentMin}` |
| `Switcher` | Equal columns → stack below a threshold            | `threshold`, `gap`                                                            |
| `Cover`    | Vertical, centred principal + pinned header/footer | `minHeight`, `gap`; `Cover.Header/Main/Footer`                                |
| `Grid`     | The CSS-Grid escape hatch (auto-fill cards)        | `min`, `gap`                                                                  |

`Stack` (vertical rhythm) is the sibling of `Cluster`; it predates this folder and
lives under `ui/molecules/stack`.

**Page shells are compositions of primitives** and belong in the Next shells, not
here — e.g. the back-office shell (`@r10c/shells-next-common`,
`src/lib/back-office/`) is `Sidebar( nav , Stack( Cluster(topbar+breadcrumbs) ,
content ) )`, with the Next coupling (routing, breadcrumbs, persisted collapse)
living in the shell because primitives stay framework- and domain-free.

## Authoring conventions

Two idioms, both merging the caller's `className` **last** via `cn(...)` and
spreading `...props`:

1. **cva** — multi-axis variant components (see `ui/atoms/button`).
2. **Static `Record<Union, string>` lookup + `cn`** — token-driven components
   (see `ui/molecules/stack`, all `ui/layout/*`). Tailwind class strings must be
   **static literals** so the scanner sees them — hence lookup records keyed by
   union types, never interpolated class names.

More rules (locked; see [[layout-primitives-decision]] in memory):

- **Polymorphism**: accept `as?: ElementType`, destructure as `as: Tag = 'div'`,
  so a primitive emits the right semantic element (`Sidebar.Side as="aside"`,
  `Cluster as="nav"`).
- **Spacing**: gap/padding are **token-key unions** mapped to `--spacing-*`; never
  a raw length.
- **Dynamic dimensions** (widths, thresholds — values Tailwind can't express as a
  static class): set an inline CSS custom property
  (`style={{ '--_side-width': width } as CSSProperties}`) consumed by a **static**
  arbitrary-value class with a token fallback
  (`basis-[var(--_side-width,20rem)]`). Private vars are prefixed `--_`.
- **Region primitives** (Sidebar, Cover) expose **compound** subcomponents via
  `Object.assign(Root, { Side, Main })`; flow primitives take children.
- **Exports are flat named** (`import { Sidebar } from '@r10c/entifix-react-controls'`).
- Add `'use client'` only to interactive/stateful components; pure presentational
  ones omit it. The directive is **per file and it survives the build**: React
  libraries compile per-file with `@nx/js:swc`, so each module keeps (or omits)
  its own. That is why no library may be bundled — merging modules drops every
  directive and leaves only an all-or-nothing bundle banner, which cannot describe
  a package that mixes client and server modules. See
  [DEVELOPING.md → How a library is built](./DEVELOPING.md#how-a-library-is-built).

## Storybook

Agnostic-only Storybook (Storybook 10 + React-Vite) hosted **in the controls
package**. It reproduces the app runtime — the Tailwind v4 pipeline
(`.storybook/preview.css` + `postcss.config.cjs`) and the `@r10c/source`
resolution condition (`.storybook/main.ts`) — and a theme toolbar
(`withThemeByDataAttribute`) flips `data-theme` across the shipped presets.

```sh
pnpm nx run entifix-react-controls:storybook        # dev server on :6006
pnpm nx run entifix-react-controls:build-storybook  # static build
```

Stories are co-located (`*.stories.tsx`) with `tags: ['autodocs']`; MDX pages
(`Introduction.mdx`, `ui/layout/Layout.mdx`) carry the prose. Story material
(`*.stories.tsx`, `_demo.tsx`) is excluded from the coverage gate in
`vitest.config.mts`. Stories **may** instantiate decorated entities, and the
entity-aware organisms have to — `EntityTable` and `EntityForm` build themselves
from metadata, so there is no way to show one without an entity. The default
React-Vite transform compiles the stage-3 decorators, and `entifix-ts-core`
polyfills `Symbol.metadata` on first import, so no SWC pass is configured here
(unlike Vitest, which runs one for the spec files).

Stories are in **no tsconfig project** (`tsconfig.lib.json` excludes them,
`tsconfig.spec.json` does not include them), so `nx typecheck` cannot see a type
error in a story and Vitest never loads one. `nx build-storybook` is therefore
the only thing that compiles them, which is why it runs in CI.

## Adding a new component — checklist

1. Pick the layer: agnostic → `controls/src/ui/{atoms|molecules|layout|organisms}/<name>/`;
   entity-tight → `implementation/<domain>/react`. Before writing an entity-tight
   one, check it is not a `makeEntityCrud` call — a table or form that varies only
   by class name is generated, not written.
2. `<name>.tsx` following an idiom above (`as`, token unions, `cn` last,
   `'use client'` only if stateful).
3. `index.ts` in the folder (`export * from './<name>'`) and a line in the
   package barrel `src/index.ts` (keep it alphabetical within its group).
4. **No copy in the component.** Every user-facing string comes from `useT()`
   and lives in the `controls` namespace
   (`packages/entifix/ts/i18n/src/resources/{es,en}/controls.ts`);
   `react/jsx-no-literals` fails the build otherwise. Dates and numbers go
   through `useFormatters()`, never a bare `toLocaleString()`. See
   [I18N.md](I18N.md).
5. `<name>.spec.tsx` — RTL, class-list / behaviour assertions, `it.each` over the
   token unions. Assertions are in **Spanish**, the default locale.
   **The package is gated at 100% coverage.**
6. `<name>.stories.tsx` with `tags: ['autodocs']` (+ an MDX page for a whole new
   family). The Storybook toolbar has a locale switch — flip it, since that is
   where a caption that outgrew its button gets noticed.
   **If the component takes `isLoading`** it must also take
   `skeleton?: boolean | ReactNode`, its default must mirror its own resolved
   geometry, and it must export a `Loading` story — the loading-contract spec
   fails the build otherwise. See
   [the loading contract](#the-loading-contract).
7. If an app renders it and it ships classes as source, add its `src` to the
   app's `global.css` `@source` list.
8. `pnpm nx run-many -t lint test typecheck build --projects=<pkg>` green.

---

# Part 2 — Workspace tabs & the client data layer

Status: **design locked; core landed** (persistent tab workspace + TanStack data
layer merged), later tab kinds in progress.

The marketplace-admin app is a back-office tool for operators who work all day across
parallel contexts (multiple catalogs today; operations and wizards later). Historically
it renders one page at a time — navigating replaces the current view and drops any
in-progress edit. The **tab workspace** lets an operator keep several work contexts
open at once, each persisted across a browser refresh and each autosaving its edit
state, plus the **client data layer** (TanStack Query over the Entifix use-cases)
that makes the workspace optimistic-first and ready for the coming WebSocket.

## Goals

- **Browser-like tabs** in the admin main section: clicking a catalog opens (or focuses) a
  tab. The set of tab _kinds_ is open and grows over time (catalogs → operations → wizards).
- **Persistence**: the open tab set survives refresh (IndexedDB), and each tab continuously
  autosaves its draft until the operator hits the real Save.
- **Deep links**: any tab is addressable by URL and shareable across browsers.
- **Both a route and a tab**: an existing page keeps working as a standalone route _and_
  renders inside a workspace tab — one encapsulated view, two hosts.
- **Optimistic, low-spinner UX**, ready to reconcile against server-pushed events.

## 1. Dual-host pages

Page content is a pure `PageView({ addr })` — it does **not** read `useParams` /
`usePathname` / the router. It renders the domain organism from a resolved **address**. Two
hosts mount the same view:

- **Route host** — the existing Next path (e.g. `/catalog/product/[slug]`) maps its params to
  an `addr` and renders `<PageView addr>`.
- **Workspace tab host** — the tab registry's `render(addr)` renders the same `<PageView addr>`.

Existing `/catalog/*` routes keep working; a page can ship standalone before it is ever
tabbed. The three **list** client pages are already prop-free and route-agnostic, so they
host in a tab unchanged; the **single-view** pages read `useParams`/`useRouter` today and get
their `slug`/nav threaded as props during the extraction.

## 2. The `TabKind` registry — the single mapper

A path is tab-able only if a registered `TabKind` matches it. The registry is the single
source of truth for URL ⇄ address ⇄ view, so route files become thin adapters that call the
same registry entry (no drift), and adding a catalog/operation/wizard is one registration —
the router never changes.

```ts
interface TabKind<TAddr> {
  kind: string; // open set: 'catalog' | 'entity' | 'operation' | 'wizard' | …
  match(paramValue: string): TAddr | null; // URL param → address (deep-link parse)
  toPath(addr: TAddr): string; // address → URL (deep-link build)
  title(addr: TAddr): string;
  render(addr: TAddr): ReactNode;
  singleton?(addr: TAddr): string; // dedupe key: focus existing vs open new
}
```

## 3. URL scheme

The workspace is a single fixed route with the **active** tab encoded in the query:

```
/workspace?tab=<kind>:<args>
    ?tab=catalog:product-specification        # a product list tab
    ?tab=entity:product-specification:123     # a product editor tab
    ?tab=operation:price-import               # future
```

Invariant: **`?tab=` present ⇒ it is a tab**; any other real path is a normal page (login,
settings, 404) that the workspace ignores. This enforces "not every path is a tab" by URL
shape rather than a match-list. The URL projects the **active** tab only; the full tab _set_
lives in IndexedDB. Any `?tab=` the registry cannot resolve — an unknown `<kind>`, or a
known kind whose payload names nothing — renders a "can't open this tab" fallback instead of
crashing. Sharing a whole workspace (multiple tabs in one link) is deferred.

**The payload after `<kind>:` is the entity key**, the same string `@entity({ key })`
derives and the sidebar's `workspace:` address carries. It is currently written in two
places that must agree — the nav and the host's tab registry — and a mismatch is invisible
by construction: the address resolves to nothing, so the control does nothing at all. That
is why an unresolvable address is answered rather than ignored: the fallback wins over the
tab that happens to be open, and the write-back below is suspended so the bad address stays
in the bar instead of being replaced by an unrelated tab. Recovery is any deliberate tab
interaction. Until the nav collapses into one source, `back-office-app`'s
`specs/workspace-registry.spec.tsx` walks every nav address through the registry.

The two directions of that projection — URL → store and store → URL — run as separate
effects, and **the write-back reads the committed store (`useTabsState.getState()`), never
this render's `activeParam`**. Following a link to a second tab changes the URL one commit
before the store catches up, so the render snapshot still names the _previous_ tab; writing
that back undoes the navigation, the URL → store effect re-opens the URL's tab, and the two
trade the address bar forever — a visible flicker between the two entities. A router double
whose `replace` actually writes `?tab=` back (`workspace-shell-url-sync.spec.tsx`) is what
holds this: a spy that swallows the write cannot see the loop at all.

## 4. State & persistence

Client state splits from server state. Three things are persisted in the browser,
and they do **not** share a contract — see
[ADR 0032](adr/0032-what-may-live-in-an-autosaved-draft.md).

- **Zustand + IndexedDB**, through the hand-rolled `makeIndexedDbStateStorage`
  (`shells-next-common/lib/workspace/`), which keys several stores into one
  object store by the `persist` `name`. There is no `zustand-indexeddb` package.
  - `useTabsState` — `{ tabs, activeParam }` + `open` / `close` / `activate`.
    A tab's dirtiness is **derived** (`selectIsDirty` asks whether the drafts map
    holds that address), never stored twice.
  - `useDraftsState` — keyed by **address**
    (`entity:product-specification:123`). Autosave is **workspace-host only**; a
    plain route stays ephemeral. Keying by address means a tab and a route view
    of the same entity converge on one draft.
- **`UiPreferencesState`** (column layout, sidebar collapse) is the Effect port,
  backed by `makeIndexedDbUiPreferencesState` + `IndexedDbUiPreferencesLayer`
  at the provider. `useUiPreference` already handles async reads, so consumers
  are unchanged.

Four rules govern a draft, and each one is enforced somewhere rather than
asserted here:

- **A draft is JSON round-trippable, period.** It is written through
  `createJSONStorage`, so a class instance, an `EntityLink` or a `Date` does not
  degrade — it comes back as something else, silently. `JsonValue` (in
  `entifix-ts-core`) is the compile-time half; `mergeDrafts` running `isJsonValue`
  per entry at restore is the runtime half. `UiPreferencesState` is deliberately
  **not** held to this: structured clone keeps a `Date`, and the two contracts
  must not be conflated. Declare a draft type as a `type`, never an `interface` —
  TypeScript gives an interface no implicit index signature, so it can never
  satisfy the constraint.
- **Relations are ids in the draft and instances beside it.** The sidecar
  (`EntityLinkSelection`) is not persisted; it is refilled from the id by
  `EntityLinkSource.selected.entity` → `useEntityForm`'s `hydrateLink`, which
  writes the sidecar without touching the draft or the dirty flag. An `embedded`
  member reaching `applyEntityLinks` with an id and no instance **throws**, and
  `EntityForm` holds Save back while any source is still resolving.
- **A version mismatch discards.** `DRAFTS_VERSION` / `TABS_VERSION` with an
  explicit `migrate` to the empty state. That covers the envelope only; member
  drift is `restoreEntityDraft`, which layers a restored draft **over** a freshly
  seeded one so the entity decides the keys and the draft decides the values.
- **Drafts are scoped by user and active organization.** `WorkspaceShell` takes a
  required `scope` prop, resolved server-side from the session (the cookies are
  httpOnly), and applies it with `persist.setOptions` **before** rehydrating.
  Without it, two accounts on one browser profile share tabs and drafts — and a
  record id is tenant-scoped, so a draft carried across an organization switch
  would be submitted into the wrong tenant. It is a separation mechanism, not a
  confidentiality boundary: whoever can read that object store already holds the
  session cookie.

## 5. The client data layer — TanStack Query **wraps** Entifix (never replaces it)

Server state (list rows, entities, menu data) is cached by **TanStack Query**. The Entifix
use-case/adapter pattern is fully intact: Effect UCs remain the fetch function; TanStack is a
client-only cache/orchestration jacket over `Effect.runPromise`.

- **Placement**: `@r10c/entifix-react-integration` (may import business + TanStack; core/business
  import neither, so layering holds). `QueryClientProvider` mounts at the shell root.
- **The seam**: `queryFn`/`mutationFn` run the UC exactly as before —
  `Effect.runPromise(Effect.provide(uc, ctx.pipe(Context.add(EntityLoadRequestTag, loadRequest))))`.
  Every `Context.Tag` DI (adapter, `EntityLoadRequestTag`, `EntityLinkResolverTag`) is provided
  as it is today. `EntifixError` surfaces through the promise rejection into `onError`.
- **Query keys** reuse the RSQL codec:
  `entityQueryKey(Ctor, req) = [envelopeEntityName(Ctor), serializeLoadRequestParams(req).toString()]`.
- **`useDataLoading` keeps its public `{ uc, ctx }` shape** — only its guts move onto `useQuery`,
  so the domain organisms (`EntityTable`, `ProductTable`, …) are unchanged.
- **`useEntityForm`** is the write-side companion that feeds `EntityForm`: it owns the string
  draft (`Record<string, string>`, seeded from the record or a persisted draft) and reports
  validation. **TanStack Form** backs it, under `revalidateLogic()` — nothing validates until the
  first submit, then every keystroke revalidates. That is an implementation detail: the hook
  returns the plain `values`/`errors`/`formError`/`setField`/`submit`/`isDirty` facade, so
  `EntityForm` renders native inputs and stays library-agnostic. Fields are therefore never
  registered via `form.Field`; a form-level validator returning `{ fields }` reaches them anyway,
  because `FormApi` creates meta for any field an error names. Saving stays on the Entifix
  mutation UCs.
- **Validation composes in three layers**, later winning on conflict: metadata rules
  (`required`/type/`enum`) → the entity's **Standard Schema** → the caller's `validate` callback.
  A schema is authored **against the string draft**, so it coerces (`z.coerce.number()`) rather
  than expecting typed values. Its messages are **catalog keys**, never sentences
  (`validation.minLength`, or a namespaced `entity:product.validation.…`), resolved with the
  literal as fallback — a rule written in one language would otherwise reach the user
  untranslated. `field` is the only interpolation parameter available, because a Standard Schema
  issue carries a message and a path and nothing else. An issue with no path becomes `formError`,
  which `EntityForm` renders above the actions. Schemas are synchronous; an async one throws, so
  asynchronous checks (a uniqueness lookup) go in `validate`.
- **Mutations** (`save`/`delete` UCs) are optimistic: `onMutate` patches the cache from the
  Zustand draft and snapshots for rollback, `onError` rolls back, `onSettled` invalidates the
  entity's query key.

### Editing a relation

A relation is set two ways, because the question differs: **quick** ("I know roughly
what it is called") is a debounced type-ahead over the target entity, filtered on
its `linkSearchProperty` with `like`; **browse** ("I need to filter the catalog") is
the target's own `EntityTable` — filters, sorting, paging and all — inside a dialog,
with `onSelect` replacing row navigation.

The split that makes it work is a boundary constraint, not taste:
`entifix-react-controls` and `entifix-react-integration` are both `entifix:react`,
so neither may import the other. They meet at **`EntityLinkSource`**, a
framework-free port in `entifix-ts-core` (plain data + callbacks: `quick`,
`browse`, `selected`, `labelOf`).

- **`EntityLinkInput`** / **`EntityLinkPicker`** (controls) are presentational: every
  option, flag and error arrives through the source, and a pick is only _reported_ —
  the input never decides how the relation is written back.
- **`useEntityLinkSource(config, { descriptor, selectedId, selectedEntity })`**
  (integration) produces one. Three requests, each held back until it means
  something: the quick search runs a small page on a debounced term, the browse list
  does not fetch until the dialog opens (`useDataLoading`'s new `enabled`), and the
  label is looked up only when there is an id but no instance — a draft restored from
  IndexedDB. It throws `EntifixLogicError` on a search property the target does not
  declare `filterable`, because the service would answer `400` and the user would
  read it as "there are no brands".
- **What may be picked** is never the UI's call: `config.loadUc` is the seam (a domain
  use-case can restrict the set), with `baseFiltering` as the lighter version — ANDed
  into every request and never shown in the filter panel.
- **`EntityForm` takes `linkSources` keyed by accessor name**, so an entity that
  declares a `link` gets an editor for free, plus `onLinkChange` → `useEntityForm`'s
  `setLink`, which writes the id into the draft and remembers the instance in `links`.
  Submit reconstructs with `applyEntityLinks` (see
  [ENTIFIX.md](./ENTIFIX.md#writing-a-relation-back-applyentitylinks)), so a relation
  travels embedded or as a key because _the entity_ says so — the form wrapper no
  longer knows the difference.
- **A `string` member gets the same editor**, and that is not a special case bolted
  on. When the target lives in **another slice's store** a typed `EntityLink` is both
  an illegal import and a cross-store join, so the member is a bare foreign key
  ([ADR 0022](./adr/0022-v1-marketplace-module-boundaries.md); `ProductSpecification`
  holds `brandId`/`categoryId` into `catalog-reference`). Nothing about the editor
  changes — `EntityLinkInput` writes `String(target.id)` into the draft either way,
  and `applyEntityLinks` skips a non-`link` descriptor, so the id simply stays the
  truth. The one type test lives in `EntityForm`'s `PICKABLE_TYPES` (`link`,
  `string`); a source aimed at anything else throws rather than being dropped,
  because a dropped source is indistinguishable from a read-only field.
  The label/search members come from the descriptor, and a scalar id's `@accessor()`
  cannot name them (it may not import the target), so the entity-tight wrapper states
  them at the `useEntityLinkSource` call.
- **The target must declare its search member `filterable`.** That metadata is also
  the server-side RSQL allowlist, so losing it fails silently at both ends: the
  service answers `400` and the picker renders it as an empty suggestion list.

One `useEntityLinkSource` call per relation, in the entity-tight wrapper: React's
hook count must stay fixed, and a generic per-field host would have to live in
controls, which cannot call an integration hook.

**Deferred**: `linkCollection` (chips + checkbox rows) — the port and
`applyEntityLinks` are shaped for it, but a to-many relation still renders read-only.

Effect ships its own `Cache`/`Query`, but TanStack wins on React optimistic ergonomics,
devtools, and the WebSocket-invalidation story — and since the fetch stays Effect, we keep both.

## 6. Loading model — server skeletons, then hydrate, then data

Three-phase paint, tuned to kill spinners:

1. **Server RSC (instant, zero fetch)** renders the static chrome skeleton — Sidebar frame, the
   new **TopBar** (user menu from the session cookie, no skeleton needed), the tab-strip frame,
   and the **active tab's** kind-specific skeleton (the active address is known server-side from
   `?tab=`).
2. **Client hydrate** — Zustand reads IndexedDB, the real tab strip fills, the active tab
   reconciles, drafts rehydrate. (The strip has a brief reconciliation settle: server renders the
   active-tab skeleton confidently and the rest as shimmer until hydrate.)
3. **Data load** via `useDataLoading` → skeleton → content. **Skeleton only on first load**;
   thereafter stale-while-revalidate keeps the last data visible and refetches in the background —
   no spinner.

### The loading contract

One question decides the shape: are users waiting for an **action to complete**,
or for **content to appear**? An action keeps its text — `form.saving`,
`auth.sessions.revoking`, and the combobox placeholder while a held link
resolves. Content gets a **skeleton**. Never both in one region: one signal per
region, or the user is being told the same thing twice.

Four rules follow, and each of them is a defect that was actually shipped:

- **A placeholder replaces the content, never stacks above it.** `EntityForm`
  used to render its shimmer _beside_ the field rows, so a loading form was
  twice the height it settled at.
- **The default mirrors the control's own resolved geometry**, which the control
  already holds while loading — `visibleColumns` for `EntityTable`,
  `resolveEntityFormFields` for `EntityForm`, both derived from class metadata
  rather than from the record. So the table draws one shimmer cell per column and
  the form one label+control pair per field, and the swap shifts nothing. A
  single full-width blob spanning the table is what this replaced.
- **First load only.** The gate is `isLoading && items.length === 0`. A refetch
  that already has rows keeps them and dims, with `aria-busy` on the container;
  replacing populated rows with shimmer on every pagination click is a grey
  flash, not a loading state.
- **Skeletons stay `aria-hidden`; the container takes `aria-busy`.** The catalog
  key is not deleted — it moves from visible text to a single `role="status"`
  announcement. Single, because both the grid and the card pivot are always in
  the DOM (CSS picks one), so a live region inside each announced twice. Never
  put `role="alert"` on a skeleton.

Every control taking `isLoading` also takes `skeleton?: boolean | ReactNode` —
`true`/omitted for the built-in default, a node to override, `false` for none.
`EntityLinkInput` and `EntityLinkPicker` are the deliberate exceptions: they take
no `isLoading` prop, reading it off the `EntityLinkSource` port instead, and the
picker's loading state simply _is_ the `EntityTable` it wraps.

For a streaming RSC route the equivalent is a `<Suspense fallback>` built from
the same `Skeleton` atoms — `ProductGridSkeleton`
(`shells/next/marketplace/src/lib/catalog/product-grid.tsx`) is the reference:
same `Grid`, same aspect ratio, so the shell does not reflow. `LoadingBoundary`
is the wrong tool there; it gates on an `isLoading` prop, which a Suspense
boundary does not have.

**Enforcement.** A lint rule for "supports a skeleton" is not writable. What is:
`src/ui/loading-contract.spec.ts` scans the source for components whose props
type declares `isLoading` and fails the build unless each ships a `Loading`
Storybook story — and `nx build-storybook` in CI proves that story renders.

## 7. Reactive updates (WebSocket-ready)

A framework-free **`ReactiveChannel` port** (a `Context.Tag`, mirroring the entifix adapter
philosophy) emits entity-change events. It is mockable today (no transport yet); a real socket
drops in later. Events feed the query client:

```
edit → optimistic patch cache (instant, no spinner)
     → save UC → backend
     → ReactiveChannel event → queryClient.invalidateQueries / setQueryData (reconcile to server truth)
```

## 8. Design-system fit

The workspace chrome stays inside the locked token contract (`@r10c/entifix-style`: semantic
`--color-*`, Utopia spacing/type steps, radius/shadow/motion tokens) and the flex-first layout
primitives. The **signature** element is the tab strip: the active tab dissolves its lower edge
into the workspace surface, and each tab carries a live **autosave pulse** — the chrome makes
"your parallel work is saved" visible, the one thing this product does that a browser's tabs do
not. `Skeleton`, `TopBar`, and `Menu` are new **agnostic** controls (in `entifix-react-controls`,
with Storybook stories); the stateful wiring (stores, registry, nav host) lives in the Next
shells, per the design-system rule.

## Component / package map

| Concern                                                                                                                                                                          | Package                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| TanStack wrapper, `entityQueryKey`, `ReactiveChannel` port, `useDataLoading`/mutation guts, `useEntityForm`, `useEntityLinkSource`                                               | `@r10c/entifix-react-integration`     |
| Agnostic UI: `EntityTable`/`EntityForm` (+`FieldControl`, `EntityLinkInput`/`EntityLinkPicker`), `Skeleton`, `TopBar`, `Menu`, `TabStrip`                                        | `@r10c/entifix-react-controls`        |
| `TabKind` registry, `tabsStore`/`draftsStore`, `EntityNavHost`, workspace shell chrome                                                                                           | `@r10c/shells-next-common`            |
| `PageView({addr})` pages, registrations, adapters                                                                                                                                | `@r10c/shells-next-marketplace-admin` |
| `(back-office)` user management over `EntityTable`/`EntityForm`, account surface, sign-in                                                                                        | `@r10c/shells-next-auth`              |
| `/workspace` route, `QueryClientProvider`, "Open in workspace" nav, `lib/nav` (the one nav definition, annotated with permissions), the three route groups, proxy route handlers | `back-office-app`                     |
| Storefront pages, chrome, `StoreLink`, fixture catalog + cookie cart — all server components                                                                                     | `@r10c/shells-next-marketplace`       |
| `app/[locale]` route tree, `loading.tsx`, cart route                                                                                                                             | `marketplace-app`                     |

**Navigation is permission-filtered, server-side.** One definition per app
(`lib/nav`) carries a `permission` per item; the sidebar layout and the workspace
menu both derive from it, so the two lists cannot disagree. Filtering is
presentation — the service refuses the request regardless — which is why the
roles behind it may be read from the cookie unverified. See
[ARCHITECTURE → Authorization](./ARCHITECTURE.md#authorization-role-aspects--permissions).

---

# Part 3 — The storefront (marketplace-app)

The back-office renders in the browser: a client page mounts `EntityTable`,
TanStack fetches, the UI assembles itself. **The storefront inverts that.** It is
public, read-heavy, and the first thing a visitor sees is the product — so the
default is a React Server Component and client code is the exception that has to
justify itself.

## What that costs, and what it buys

|                   | Back-office                        | Storefront                                 |
| ----------------- | ---------------------------------- | ------------------------------------------ |
| Default component | client                             | **server**                                 |
| Locale            | `x-r10c-locale` header → dynamic   | `[locale]` route param → **prerenderable** |
| Data              | TanStack over REST, in the browser | use-case run on the server, in the page    |
| Links             | `LocaleLink` (client)              | `StoreLink` (**server**)                   |
| CTA               | `Button`                           | `ButtonLink` where the click navigates     |
| Mutations         | mutation hooks                     | `<form action={serverAction}>`             |

Home and every product page are prerendered per locale with ISR. `/cart` reads
`cookies()` and `/search` reads `searchParams`, so both are dynamic — correctly,
since neither has an answer until the request arrives. `/c/[category]` is dynamic
too: reading `searchParams` opts out the **route**, not the request, so the
intended "static unfiltered, dynamic when sorted" split is not expressible
without Partial Prerendering.

## Two rules that are easy to get wrong

**Import from `@r10c/entifix-react-controls/primitives`, not the barrel.** The
main entry is one flat re-export, and a bundler cannot drop what the module graph
reaches: importing `Card` from `.` pulled `EntityTable`, `FilterBuilder`, the
column/sort builders and the whole Effect runtime (via the UI-preferences store)
into the storefront's client bundle — 541 KB of back-office UI plus Effect,
shipped to someone looking at a lamp. The `/primitives` entry is the
presentational, entity-free half; the main barrel still re-exports all of it, so
no existing import breaks.

**Anything a server component calls ships from `/server`.** `@r10c/shells-next-marketplace`
splits its surface exactly like `shells-next-common`: `/server` for pages, Server
Actions and `next/headers` readers, `.` for the one client island. A module that
mixes the two — as `cart-cookie` first did, holding both the pure wire format and
a `cookies()` reader — drags a server-only API into the browser bundle and Next
refuses to build it.

## The cart, and where static-first actually breaks

Cart state lives in a **cookie**, not `localStorage`, so `/cart` renders the
visitor's items in the first response instead of flashing "empty" and correcting
itself after hydration.

The header badge is the one place the model genuinely strains: it sits inside
prerendered pages, which by definition cannot know a count. It ships countless in
the static HTML and fills in client-side via `useSyncExternalStore` — whose
separate server snapshot is what makes the two renders legitimately differ
instead of being a hydration mismatch. Two consequences worth knowing:

- `document.cookie` returns the value **percent-encoded**. The server never sees
  this because Next's `cookies()` decodes for you, so a missing
  `decodeURIComponent` is invisible to every server-side test and shows up only
  as a badge stuck at zero.
- The island reads the cookie on mount, and a Server Action leaves it mounted —
  so add-to-cart **redirects** to the cart. The navigation is the feedback;
  without it the click looks like it did nothing.

## Deferred

Real data (ADR 0009's published catalog), checkout, product imagery beyond fixed
aspect-ratio placeholders, PPR, a CI bundle-size budget.

---

# Deferred (workspace)

Real WebSocket transport; cross-browser-tab collision sync (BroadcastChannel vs last-write-wins);
stale-draft-vs-server conflict resolution on Save; whole-workspace share link; operations/wizards
tab kinds; server-side TanStack dehydration/prefetch; the to-many link editor
(`linkCollection`) and an ABAC `canLink` policy behind the picker's use-case seam.
