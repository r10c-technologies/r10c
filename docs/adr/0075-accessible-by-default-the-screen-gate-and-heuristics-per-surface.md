# 75. Accessible by default: the screen gate, and heuristics weighed per surface

- Status: Proposed
- Date: 2026-11-05
- Area: frontend
- Read when: a screen fails an accessibility check, adding a screen or a palette, or weighing a usability finding on the storefront versus the back office — r10c only narrows entifix's WCAG 2.2 AA, deterministic checks gate every screen type, heuristics never do

## Context

Both frontends are built from entifix's agnostic layer, which entifix records
0024–0028 now hold to WCAG 2.2 AA. What reaches a user is the screen, and the
screen is r10c's: two app palettes, the storefront's own components in
`@r10c/utils-react-ui` and the marketplace shell, hand-built screens (till,
product wizard, sessions, receipt), and how the shells compose entifix's
organisms.

A live audit of 24 screens on 2026-11-05 found the following.

**Axe**

- Every violation was `serious`.
- The back office failed target-size in the sidebar on **every** screen, 36–51
  nodes.
- Both light palettes failed contrast on the brand primary:
  - the storefront's `marketplace`, 3.51;
  - the back office's runtime `ocean`, 4.16.
- The dark palettes were nearly clean.

**Keyboard**

- Neither app has a skip link.
- The first Tab stop inside `main` is **#71** on every back-office screen,
  because each nav item costs three stops.
- After a save, a delete, a checkout or a cancel, focus lands on `<body>`.
- An empty toast region covered two focused links.

**Heuristics** — 4 distinct findings that block a task (8 raw, deduplicated), 38 that slow one, 6 cosmetic.
The blocking ones:

- a generated Delete that hard-deletes in one click;
- a storefront "Cancelar pedido" that refunds in one click under a heading that
  still says "¡Gracias por tu compra!";
- a till summary printing 6499 GTQ for an item priced 64,99 GTQ;
- a command palette rendering 40px wide.

**The two surfaces fail differently, for different users**

- The **storefront** is for first-time buyers on a phone. Its losses come from
  irreversible buttons, unannounced outcomes, a header that fills the first
  screen at 320px and fails reflow, and a non-commerce theme switcher sitting
  beside the cart.
- The **back office** is for experts working all day, at fixed scale and compact
  density. Its losses come from throughput: 71 stops before the content, no
  header sort, no bulk verbs on screen, and UUIDs where names belong.

One severity scale applied evenly to both would rank them badly.

Research on using a language model as the evaluator also shapes how findings
are used:

- It finds about a fifth of the issues expert evaluators find.
- It ranks problems relative to each other reasonably.
- Its absolute severity ratings barely agree across runs (Krippendorff's alpha
  near zero).

## Decision

### The target is entifix's, narrowed where the product needs it

- **r10c conforms to WCAG 2.2 AA through entifix [0024](https://github.com/r10c-technologies/entifix/blob/v0.18.2/docs/adr/0024-wcag-2-2-aa-and-the-gates-that-ratchet-to-it.md).** It may narrow
  that target, never loosen it.
- **One narrowing: the storefront's primary touch targets are 44px.** That is
  the add-to-cart, quantity, checkout and the cart link, set by overriding
  `--target-min` on those controls. The rest of the storefront and the back
  office keep 24px.
- **3.3.8 Accessible authentication is assessed for Zitadel's hosted login
  separately.** That page is a foreign system ([ADR 0016](0016-zitadel-authenticates-r10c-authorizes.md),
  [0018](0018-the-hosted-login-is-a-second-container.md)) and r10c's conformance
  statement says so.

### Every palette is held by the contract

- `apps/marketplace-app/src/app/themes.css` and every back-office runtime
  palette are asserted by entifix's `assertPaletteContract` from a
  `@r10c/conventions` spec. A palette that fails a pair fails the build.
- `ThemePalette` values declare `focus-ring`, `border-control` and `selected`.

### Every screen type is gated, deterministically

- **Where.** Each `apps/*-app-e2e` mock journey (`E2E_PROFILE=mock`) calls
  `expectNoNewA11yViolations` and `walkKeyboard` from `@entifix/testing-e2e/a11y`.
- **Which screens.** One representative of each ADR 0033 screen type —
  Definiciones, Operaciones, Asistentes, Consultas — plus each hand-built
  screen: till, product wizard, account and sessions, user creation,
  configuration, storefront home, category, search, product, cart, receipt and
  not-found.
- **Under both palettes of each app.**
- **The fingerprint baseline is committed per e2e project** as
  `a11y-baseline.json`. Every entry names the issue that removes it, and a stale
  entry fails like a new one.
- **The walk asserts:**
  - a skip link is the first stop;
  - the first stop inside `main` is at index ≤ 3;
  - no stop has an invisible indicator;
  - no stop is obscured;
  - focus is never on `<body>` after a save, a delete, a checkout or a cancel.
- **The walk's thresholds ratchet like the fingerprints.** The back office
  meets neither target today (no skip link, first stop in `main` at #71), so its
  measured values are committed beside the issue that tightens them, and the
  record holds when that issue closes, not before.
- **The live fleet is for research only.** No gate depends on it.

### Heuristics are weighed per surface, and never gate

A heuristic finding is recorded with the heuristic, the observed consequence
(`blocks-task`, `slows-task`, `cosmetic`), a screenshot and repro steps. A
person confirms the severity. The weighting is:

| Surface              | Weighted high                                   | Weighted low  | What the high weight means here                                                                                                                                                                                                                                                                      |
| -------------------- | ----------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront           | H8 minimalism, H5 error prevention, H9 recovery | H7 efficiency | Any non-commerce control above the fold is a finding; an irreversible act confirms; a failed read or payment offers a way back; a pending order never reads as paid ([ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)). No shortcuts and no density mode. |
| Back office          | H7 efficiency, H4 consistency                   | —             | Header sort, bulk where ADR 0035 declares it, filters in the URL, a working palette, one Tab stop per nav group, a search or scan field on the till. H8 judges signal: raw ids, internal codes and visible id columns fail it, however compact.                                                      |
| Wizards and the till | the storefront's H5 and H2                      | —             | They are task-shaped, and both blocking till findings are H2/H5.                                                                                                                                                                                                                                     |

A heuristic finding becomes an issue. It never becomes a CI rule unless it is
restated as one of the deterministic checks above.

### The storefront's generic primitives move to entifix

- **Breadcrumbs, Badge/Chip, PriceBlock (as `Money`) and MediaGallery leave
  `@r10c/utils-react-ui`** for entifix's agnostic layer, where the gate covers
  them.
- **SortControl becomes entifix's `SegmentedNav`.**
- **ProductCard, FacetPanel and CategoryNav stay**, because they carry commerce
  vocabulary, and are rebuilt on entifix atoms.
- **The dead exports go in the same change.** Badge, Chip and PriceBlock have no
  importer, so they are adopted by the move or deleted, not left behind.

### Theme and density are the user's

The back office gains theme and density in the account menu, persisted through
the UI-preferences port. Comfortable density then has a real user, and the
gate's matrix is a setting rather than a forced attribute.

## Consequences

- Every mock e2e journey gains two calls and a baseline file. A palette or shell
  change now fails a journey it never touched, which is what the gate is for.
- The storefront's 44px floor enlarges its buy box. It is deliberate, and limited
  to the primary touch targets.
- Business-rule questions the audit surfaced are recorded, not decided here:
  - whether `dispatch`, `record-refusal` and `record-return` should confirm;
  - whether checkout should have a review step.

  Each is an issue for a person, outside any acceptance criterion.

- [ADR 0051](0051-the-storefront-reads-the-projection.md)'s "a failed read
  renders an empty catalog and logs" is revised in place when the degraded
  notice lands. It still renders and logs, but the copy is a `role=status`
  notice with a retry link rather than the empty-catalog message, since a buyer
  cannot tell "nothing for sale" from "we could not ask".

## Trigger

Promoted to **Accepted** by the change in which every mock e2e project calls
both helpers on every screen named above with a committed baseline, and the
palette contract spec runs green over both apps' palettes.
