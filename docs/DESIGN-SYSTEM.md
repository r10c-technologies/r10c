# Design system

The agnostic UI kit and the conventions for extending it. Two homes:

- **`@r10c/entifix-react-controls`** (`packages/entifix/react/controls`) — every
  **entity-agnostic** component: `ui/atoms`, `ui/molecules`, `ui/layout`,
  `ui/organisms`. Knows nothing about any domain.
- **`implementation/<domain>/react`** — **entity-tight** components (e.g.
  `ProductTable`), usually thin wrappers over agnostic organisms.

Styling foundation lives in **`@r10c/entifix-style`** (`packages/entifix/style`,
CSS-only): `tokens.css` declares the Utopia fluid scales, the layout tokens, and
the semantic colour **contract**; `presets/*` and app-local `themes.css` override
the contract values per palette. See [design-system-theme] in memory and
`docs/ENTIFIX.md`.

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

More rules (locked; see [layout-primitives-decision] in memory):

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
