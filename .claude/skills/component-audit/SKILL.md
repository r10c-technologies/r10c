---
name: component-audit
description: Run and read r10c's accessibility gates before changing a component or a screen — the Storybook axe run, the e2e screen gate, the keyboard walk, the fingerprint baselines and the hand-rolled-control conventions. Use when adding or editing a storefront or back-office component, a screen, a story, or an `a11y-baseline.json` / `a11y-todo.json` entry, or when one of those gates fails.
---

# Component audit

Every rule below is enforced by a check that fails the build, and each one
links that check. A rule with no check is not here: under
[ADR 0046](../../../docs/adr/0046-conventions-are-checked-not-stated.md) a
convention that is only stated gets skipped. The reasoning behind all of it is
[ADR 0075](../../../docs/adr/0075-accessible-by-default-the-screen-gate-and-heuristics-per-surface.md),
which narrows entifix's WCAG 2.2 AA for r10c.

## Before you change a component

- Use entifix's component before writing one. A message is `Alert` (it picks
  `role="alert"` or `role="status"` from its tone), an empty region is
  `EmptyState`, a count is `QuantityInput`, a number is `NumberInput`, a price
  is `Money`, a server form's button is `SubmitButton`. A shell that writes the
  role, a danger colour beside a role, or `type="number"` by hand fails
  [the conventions spec](../../../tools/conventions/src/accessibility.spec.ts).
- A click target must be reachable by keyboard: a clickable `<div>` fails
  `jsx-a11y` at error level in every rendering project, proved against a
  planted violation by
  [the conventions spec](../../../tools/conventions/src/accessibility.spec.ts).
- Copy in JSX goes through the catalogs, never a literal: `react/jsx-no-literals`
  fails the lint, run by `pnpm nx run @r10c/shells-next-marketplace:lint` (and
  every rendering project's `lint`). A glyph that is not copy goes in a
  constant, `aria-hidden`.

## The Storybook gate

- Every story renders in both palettes under axe, and fails on a story that
  throws, renders nothing or raises a violation:
  `pnpm nx run @r10c/storefront-storybook:test-a11y`. Build it first with
  `pnpm nx run @r10c/storefront-storybook:build-storybook`.
- A story with a known violation is listed in
  [`a11y-todo.json`](../../../apps/storefront-storybook/a11y-todo.json) against
  the issue that removes it. The list only shrinks: a listed story that no
  longer violates anything fails the run
  ([the reporter](../../../apps/storefront-storybook/.storybook/a11y-todo-reporter.ts)).
- Every todo entry must name an issue and a story that still exists, or
  [the conventions spec](../../../tools/conventions/src/accessibility.spec.ts)
  fails. Delete a component's story and its entry goes in the same change.

## The screen gate

- Each mock e2e journey runs `expectNoNewA11yViolations` and `walkKeyboard` on
  every gated screen in both palettes: the storefront's
  [screen walk](../../../apps/marketplace-app-e2e/src/a11y.mock.spec.ts) through
  `pnpm nx run @r10c/marketplace-app-e2e:e2e`, and the back office's
  [screen walk](../../../apps/back-office-app-e2e/src/a11y.mock.spec.ts) through
  `pnpm nx run @r10c/back-office-app-e2e:e2e`.
- The walk asserts a skip link first, the first stop in `main` within the
  project's index, a visible and unobscured indicator on every stop, and focus
  never left on `<body>` after a save, a delete, a checkout or a cancel. Its
  options live in each project's helpers: the
  [storefront's](../../../apps/marketplace-app-e2e/src/a11y.ts) and the
  [back office's](../../../apps/back-office-app-e2e/src/a11y.ts).
- A new screen gets a step in its project's screen walk, so it is gated in both
  palettes from the commit that adds it
  ([storefront](../../../apps/marketplace-app-e2e/src/a11y.mock.spec.ts)).

## Reading and removing a baseline entry

- A baseline maps a fingerprint to the issue that removes it. A fingerprint is
  `rule|selector|screen:palette`, where the selector is the element's ancestry
  with every `:nth-child` index replaced by `n` (scheme `ancestry-1`), so a
  sibling added above the element does not change it. See the storefront's
  [`a11y-baseline.json`](../../../apps/marketplace-app-e2e/src/a11y-baseline.json).
- Fix the violation, then delete its entry by hand. A stale entry fails the
  screen gate like a new violation does, so the two land together
  (`pnpm nx run @r10c/marketplace-app-e2e:e2e`).
- Never grow a baseline to make a regression pass. `A11Y_BASELINE=update`
  rewrites one happily, which is why CI refuses a pull request whose baseline
  gained an entry over the merge base
  ([the growth check](../../../tools/ci/a11y-baseline-growth.mjs)).
- Every baseline entry must name its issue, checked by
  [the conventions spec](../../../tools/conventions/src/accessibility.spec.ts),
  and a daily run fails once a named issue has closed
  ([the todo workflow](../../../.github/workflows/a11y_todo.yml)).
