# 27. Two scales, a density mode, and the type system

- Status: Accepted
- Date: 2026-09-01

## Context

The back office is for complex, repetitive operator work, and it does not use
its space well. That is not a discipline problem — the scale is the wrong scale.

`packages/entifix/style/src/tokens.css` generates spacing and type with the
Utopia calculator for **prose at an 18–20px base**, viewport 360–1240. Resolved,
the spacing steps are:

```
3xs ≈ 4.5px   2xs ≈ 9px   xs ≈ 13.5px   s ≈ 18px   m ≈ 27px   l ≈ 36px   xl ≈ 54px
```

`2xs → s` is a **2× jump**, and nothing lands on 4, 8, 12 or 16 — the sizes a
dense grid needs. Measured across `entifix-react-controls` and the shells,
`gap-2xs` (32), `px-2xs` (19), `py-3xs` (16) and `px-s` (15) carry most of the
call sites while `2xl` and `3xl` are used twice between them. **The bottom third
of a nine-step scale carries everything**, which is what a scale looks like when
its steps do not match the work. Compounding it, `--text-step-0` was 18–20px, a
reading size, where admin tables want 13–14px.

Three further gaps sat alongside it, and they are the reason this is one record
rather than four:

- **There was no typeface at all.** No `--font-*` family, no weight scale, no
  line-height or letter-spacing tokens, and no `next/font` anywhere in `apps/`
  or `packages/shells`. Both apps rendered in the OS default sans, so the
  product looked different on every operating system. Weight was applied ad hoc
  (13 × `font-semibold`, 8 × `font-medium`, 3 × `font-bold`, 2 × `font-normal`)
  with no rule for which meant what.
- **There was no focus ring.** `focus:outline-none` appeared at nine call sites;
  six put a ring back, and two of the remaining three are focus-managed
  containers where that is correct. Operator efficiency _is_ keyboard use, so
  this is load-bearing rather than cosmetic.
- **Border widths did not exist as tokens**, and shadow values hardcoded a
  slate tint that the file's own comment claimed palettes could override.

## Decision

### One contract, two scales

Spacing and type keep **one set of token names**. The values differ per app:

- the **fluid** Utopia scale stays the default in `tokens.css`, and the
  storefront keeps it — it is read at arm's length on a phone, which is what
  that scale is for;
- a **fixed** 4px-aligned scale lives in `presets/fixed-scale.css`, and dense
  operator UI opts into it.

This is the mechanism `--color-*` already used, extended to measurement. It
works because Tailwind emits spacing and type utilities **by reference** —
`.p-s { padding: var(--spacing-s) }` — so redefining the custom property
re-scales every existing call site. Verified in the browser before the rest of
this record was written: toggling the attribute moved a `p-s` element from
19.64px to 4px.

|                    | 3xs | 2xs | xs   | s   | m   | l   | xl  | 2xl | 3xl |
| ------------------ | --- | --- | ---- | --- | --- | --- | --- | --- | --- |
| fluid (storefront) | 4.5 | 9   | 13.5 | 18  | 27  | 36  | 54  | 72  | 108 |
| fixed, comfortable | 4   | 8   | 12   | 16  | 24  | 32  | 48  | 64  | 96  |
| fixed, compact     | 2   | 4   | 8    | 12  | 20  | 28  | 40  | 64  | 96  |

Back-office type is fixed at an 11 / 12 / **14** / 16 / 20 / 24 / 32 px scale.
A size that interpolates with the viewport cannot be aligned to a row height,
which is the whole point of a dense grid.

### Opt-in is an attribute, not an import

`presets/fixed-scale.css` changes nothing when imported. Every rule is keyed to
`[data-scale='fixed']` or `[data-density=…]`, exactly as a palette is keyed to
`[data-theme]`. An app opts in once:

```html
<html data-theme="aurora" data-scale="fixed" data-density="compact"></html>
```

Custom properties inherit, so the nearest ancestor that sets one wins for its
subtree. That is what lets the Storybook specimen show both scales on one page,
and what lets a comfortable screen hold one compact region later without a
second stylesheet.

### Density compacts spacing, never type

`[data-density]` on the root. Not a per-component prop — that is combinatorial,
and every control carries it forever. Not a media query either: density is a
property of the **work**, not of the viewport, which is why it does not violate
the flex-first, no-media-query rule in `docs/FRONTEND.md`.

Only spacing compacts. Shrinking text is how a compact mode becomes an
accessibility problem, and the base size is already corrected by the scale — the
prior art agrees (Cloudscape reduces spacing in increments of 4 and leaves type
alone). `2xl` and `3xl` are untouched by density: they carry page-level rhythm,
and compacting them buys nothing per row while making a screen feel cramped
rather than dense.

**The exclusion list** is alerts, help panels and date pickers, marked with
`[data-density-exclude]`. Density is selective: an alert must interrupt, help
text is read rather than scanned, and a date picker is a hit-target grid already
at the floor.

### Inter and JetBrains Mono, three weights

`next/font/google` in each app, exposed as `--font-inter` /
`--font-jetbrains-mono` and placed at the front of `--font-sans` / `--font-mono`
in the token file. Tailwind's `--default-font-family` reads `--font-sans`, so
the face is a token like every other value and no `html { font-family }` remains
anywhere.

The fonts module is **duplicated per app** rather than shared from a package.
`next/font/google` is a compiler macro — Next resolves the call at build time,
downloads the files, self-hosts them from the app's own origin, and generates a
`size-adjust` fallback face. A workspace library ships as prebuilt `dist`
JavaScript, so the call would reach the runtime unprocessed. Ten lines twice is
the cost of not breaking that, and the `size-adjust` fallback is what keeps the
prerendered storefront from lurching on swap.

Each step carries its own line-height and letter-spacing through Tailwind's
`--text-*--line-height` and `--text-*--letter-spacing` modifiers, so a size
utility brings its whole typographic setting with it. A type scale is not a list
of sizes.

**Three weights**: 400 body, 500 secondary emphasis, 600 headings and labels.
`bold` (700) is removed from the `Text`/`Heading` API — "heading" and "emphatic
heading" were never distinct roles here, only different authors. A fourth weight
returns when a role needs it, not when a screen wants one. Using
`font-semibold` directly on an element the design system does not own (a
HeadlessUI `DialogTitle`) stays legal: the rule is that only three weights
exist, not that every weight must be routed through a component.

**Tabular figures are not set on the face.** A column of money must align and
prose must not, so `tnum` on `--font-sans` would restyle every storefront
paragraph to fix a table. `CellValue` applies `tabular-nums` for `number` and
`date` members — the one place that already knows which is which.

### The focus ring is one utility

`@utility focus-ring` replaces the three-class incantation
(`focus:outline-none focus-visible:ring-2 focus-visible:ring-accent`) that was
copied into six controls and forgotten in the rest.

It is an `outline`, not a box-shadow ring, for three reasons that all matter on
a dense screen: it follows `border-radius`, an ancestor's `overflow: hidden`
cannot clip it, and it costs no layout. It matches `:focus-visible` **and**
`[data-focus]`, because HeadlessUI drives Radio, MenuItem and ComboboxOption
with the attribute rather than native focus — without that arm, a HeadlessUI
control has no ring while wearing the class that says it does.

`--color-focus-ring` is its own token, not a reuse of `--color-accent`: it must
clear the 3:1 non-text contrast minimum against that palette's surfaces, and an
accent chosen to look good as a link does not automatically do that. Every
shipped palette's value was computed rather than eyeballed; the lowest is 4.63:1.

### Elevation is four named rungs, outside `@theme`

`shadow-edge` → `shadow-raised` → `shadow-card` → `shadow-overlay`.

Two measurements forced this shape. First, **Tailwind parses a `@theme` shadow
at build time** so it can support the `shadow-<color>` modifier, and inlines the
resolved color into the utility:

```css
.shadow-card {
  --tw-shadow: 0 4px 16px -4px var(--tw-shadow-color, #0f172a1a);
}
```

A `[data-theme]` block redefining `--shadow-card` therefore changed nothing —
which is exactly what `sunset`, `midnight` and `marketplace-dark` had each been
doing, in dead CSS, since they were written. Second, **a custom `@utility` does
not win against a theme-generated one**: `@utility shadow-sm` was measured still
resolving to Tailwind's own default. So the rungs are named for what they mean,
which avoids the collision and is what they should have been called anyway.

Plain custom properties plus hand-written utilities cost the color modifier
(nothing uses it) and buy back the one property elevation actually needs: a
palette re-tints in **one line** with `--shadow-tint` and `--shadow-strength`.
Dark palettes still restate `--shadow-card` and `--shadow-overlay`, because a
dark surface needs different blur _geometry_, not merely more opacity.

## Consequences

- A component never learns which app it runs in. `SpacingToken`, `GAP`,
  `PADDING` and every `p-s` / `gap-2xs` call site are untouched by this change —
  that is the payoff of keeping names and moving values.
- The storefront's product-page placeholder initial renders at its intended size
  for the first time. `text-step-4` was in use against a scale that stopped at
  `step-3`, so Tailwind emitted no utility at all and the glyph fell back to
  body size. Adding the step fixes it with no call-site change.
- Elevation call sites moved (`shadow-xs`/`sm`/`lg` → `edge`/`raised`/
  `overlay`, 13 sites). `shadow-card` kept its name.
- Two documented seams now exist where one would be simpler. The fonts module is
  duplicated per app, and Storybook loads the same two families from
  `@fontsource-variable/*` because it has no Next compiler. Both paths end at
  the same two CSS variables; if a specimen ever looks different from the app,
  that is the seam that drifted.

## Alternatives considered

- **Two token files, one per app.** Rejected: they drift, and the drift is
  invisible until someone screenshots both apps side by side.
- **A `density` prop on every component.** Rejected: combinatorial, and every
  control carries it forever. The attribute is one decision at the root.
- **A media query for density.** Rejected on the merits, not just the house
  rule: a 27" monitor is not evidence that the person at it wants roomy rows,
  and a laptop is not evidence they want dense ones.
- **Keeping `shadow-xs`/`sm`/`lg` and forcing the override.** Rejected: it
  fights Tailwind's own namespace to keep names that describe size rather than
  meaning.
- **A TS export from `entifix-style`** so `tools/zitadel-seed.mjs` could stop
  duplicating the aurora and midnight hexes. Declined here. The seed is a plain
  Node script that runs at fleet boot; making it depend on a built `dist` trades
  a documented, `ZITADEL_SEED_REVISION`-pinned copy for a build-order coupling
  in the boot path. The copy stays, and so does the rule that changing those
  four values means bumping the seed revision.
- **A fourth weight.** Rejected until a role needs one. Three cover body,
  secondary emphasis and headings, which is what the measured usage was actually
  expressing.

## Relationship to other records

This record adds a layer that no previous ADR covered; it supersedes nothing and
amends nothing. [ADR 0003](0003-i18n-mandatory.md) is unaffected — the specimen
pages are Storybook `.mdx`, which is exempt from `react/jsx-no-literals` because
the English on them _is_ the specimen.
