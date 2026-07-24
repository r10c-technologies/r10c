# Frontend

Everything about the client side: the agnostic **design system** (UI kit, layout
primitives, tokens, Storybook) and the **workspace tabs + client data layer** the
marketplace-admin app is built on. Backend/domain architecture is in
[ARCHITECTURE.md](./ARCHITECTURE.md); the entity framework the UI renders is in
[ENTIFIX.md](./ENTIFIX.md).

---

# Part 1 — Design system

The agnostic UI kit and the conventions for extending it. Two homes:

- **`@r10c/entifix-react-controls`** (`packages/entifix/react/controls`) — every
  **entity-agnostic** component: `ui/atoms`, `ui/molecules`, `ui/layout`,
  `ui/organisms`. Knows nothing about any domain.
- **`implementation/<domain>/react`** — **entity-tight** components (e.g.
  `ProductTable`), usually thin wrappers over agnostic organisms.

Styling foundation lives in **`@r10c/entifix-style`** (`packages/entifix/style`,
CSS-only): `tokens.css` declares the Utopia fluid scales, the layout tokens, and
the semantic colour **contract**; `presets/*` and app-local `themes.css` override
the contract values per palette. See [[design-system-theme]] in memory and
[ENTIFIX.md](./ENTIFIX.md).

## Foundations (Utopia)

Spacing (`--spacing-3xs…3xl`) and type (`--text-step-xs…3`) are `clamp()` scales
generated with the [Utopia](https://utopia.fyi) calculator — they interpolate
with the viewport, so there are far fewer breakpoints. Two layout tokens back the
primitives:

- `--measure` — max line length (readability cap for `Center`).
- `--grid-min` — minimum card-column width for `Grid`.

Components **never** use raw colours or pixel gaps: they reference token
utilities (`bg-surface`, `text-content`, `gap-s`, `p-m`, `text-step-1`). Tailwind
is v4 **CSS-first** — no config file; tokens are declared via `@theme` in
`tokens.css`.

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
  ones omit it.

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
`vitest.config.mts`. Stories must **not** instantiate decorated entities, so the
default React-Vite transform suffices (no SWC decorator pass, unlike Vitest).

## Adding a new component — checklist

1. Pick the layer: agnostic → `controls/src/ui/{atoms|molecules|layout|organisms}/<name>/`;
   entity-tight → `implementation/<domain>/react`.
2. `<name>.tsx` following an idiom above (`as`, token unions, `cn` last,
   `'use client'` only if stateful).
3. `index.ts` in the folder (`export * from './<name>'`) and a line in the
   package barrel `src/index.ts` (keep it alphabetical within its group).
4. `<name>.spec.tsx` — RTL, class-list / behaviour assertions, `it.each` over the
   token unions. **The package is gated at 100% coverage.**
5. `<name>.stories.tsx` with `tags: ['autodocs']` (+ an MDX page for a whole new
   family).
6. If an app renders it and it ships classes as source, add its `src` to the
   app's `global.css` `@source` list.
7. `pnpm nx run-many -t lint test typecheck build --projects=<pkg>` green.

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
    ?tab=catalog:product            # a product list tab
    ?tab=entity:product:123         # a product editor tab
    ?tab=operation:price-import     # future
```

Invariant: **`?tab=` present ⇒ it is a tab**; any other real path is a normal page (login,
settings, 404) that the workspace ignores. This enforces "not every path is a tab" by URL
shape rather than a match-list. The URL projects the **active** tab only; the full tab _set_
lives in IndexedDB. An unknown `<kind>` renders a "can't open this tab" fallback instead of
crashing. Sharing a whole workspace (multiple tabs in one link) is deferred.

## 4. State & persistence

Client state splits from server state:

- **Client state → Zustand + IndexedDB** (via `zustand-indexeddb`, which keys multiple
  stores in one database by the `persist` `name`):
  - `tabsStore` — `{ tabs, order, activeId, dirty }` + `openOrFocus` / `close` / `setActive`.
  - `draftsStore` — keyed by **address** (`entity:product:123`), debounced autosave. Autosave
    is **workspace-host only**; the route host stays ephemeral. Keying by address means a tab
    and (optionally) a route view of the same entity converge on one draft.
- **`UiPreferencesStore` migrates from localStorage to IndexedDB.** The Effect port
  (`read`/`write`/`remove`) is unchanged — only a new `makeIndexedDbUiPreferencesStore` +
  `IndexedDbUiPreferencesLayer` swap in at the provider. This unifies all persisted client
  state in one store (no localStorage/IndexedDB split) with no consumer changes — `useUiPreference`
  already handles async reads.

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
- **Mutations** (`save`/`delete` UCs) are optimistic: `onMutate` patches the cache from the
  Zustand draft and snapshots for rollback, `onError` rolls back, `onSettled` invalidates the
  entity's query key.

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

| Concern                                                                                     | Package                               |
| ------------------------------------------------------------------------------------------- | ------------------------------------- |
| TanStack wrapper, `entityQueryKey`, `ReactiveChannel` port, `useDataLoading`/mutation guts  | `@r10c/entifix-react-integration`     |
| Agnostic UI: `Skeleton`, `TopBar`, `Menu`, `TabStrip`/`Tab`; IndexedDB `UiPreferencesStore` | `@r10c/entifix-react-controls`        |
| `TabKind` registry, `tabsStore`/`draftsStore`, `EntityNavHost`, workspace shell chrome      | `@r10c/shells-next-common`            |
| `PageView({addr})` pages, registrations, adapters                                           | `@r10c/shells-next-marketplace-admin` |
| `/workspace` route, `QueryClientProvider`, "Open in workspace" nav                          | `marketplace-admin-app`               |

## Deferred

Real WebSocket transport; cross-browser-tab collision sync (BroadcastChannel vs last-write-wins);
stale-draft-vs-server conflict resolution on Save; whole-workspace share link; operations/wizards
tab kinds; server-side TanStack dehydration/prefetch.
