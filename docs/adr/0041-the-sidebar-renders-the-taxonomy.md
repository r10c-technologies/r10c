# 41. The sidebar renders the taxonomy, and a shell may ask about the viewport

- Status: Accepted
- Date: 2026-09-06
- Amends: [ADR 0033](0033-the-screen-taxonomy.md) (its "the sidebar does not yet
  render the tier" consequence is now discharged, and the nesting depth it left
  open is fixed here).

## Context

ADR 0033 fixed the information architecture — the top tier is the **screen
type**, the domain sits beneath it — and #190 landed `GuardedNavSection.type` so
every contributing shell could declare it. Nothing rendered it.

The field was declared, propagated, and then thrown away one hop before it was
needed. `visibleNav` in `apps/back-office-app/src/lib/nav.ts` carries a doc
comment saying a filter that dropped `type` "would leave the tier unbuildable
downstream"; sixteen lines below it, `sidebarNav` rebuilt each section as
`{ title, items }` and dropped exactly that. Every test still passed, because
nothing consumed the field.

Three further gaps, all measured rather than suspected:

- **Collapsed mode had no group headings at all.** `section.title && !collapsed`
  meant collapsing produced an undifferentiated icon column. Three sections
  today; ADR 0022 fixes 11 domains and 28 entities.
- **There was no mobile behaviour.** The aside was `md:sticky md:top-0
  md:h-screen md:overflow-y-auto` and nothing else, so below `md` it stacked
  above the content and scrolled away. No drawer, backdrop, focus trap or
  escape-to-close.
- **The "open in workspace" control was invisible unless hovered.** `opacity-0`
  until `group-hover/nav`, which is no hover at all on touch, and gated on
  `!collapsed`, so it disappeared in the mode a power operator lives in. There
  was no open-in-a-browser-tab control; middle click worked by accident.

## Decision

### Depth is capped by construction, not by convention

Three tiers — type › domain › destination — and `NavItem` has no children, so a
fourth is unsayable. #113 asked for the cap to live "in the type, not by
convention"; an interface in which deeper nesting cannot be expressed is the
strongest available form of that.

The type tier is a **grouping of the sections that already exist**, keyed on
`GuardedNavSection.type` and ordered by `screenTypeRank`. Sections are grouped by
rank rather than by position, because a host concatenates fragments from several
shells and two of them can legitimately contribute `master` sections that are not
adjacent — grouping by position would render Definiciones twice.

The tier's label is not the host's to translate. `SCREEN_TYPE_LABEL_KEYS` maps
each type into the `shell:` namespace, and `SidebarNav` resolves it there, so the
tier costs no new copy and no new plumbing through the server-rendered chrome.

### Collapsed mode does not nest, so it needs no flyout

#113 framed this as a fork: "collapsed groups need flyouts, or nesting makes
collapsed mode strictly worse than today". The other branch is taken. When
collapsed, the icon column stays flat, the type tier degrades to a rule carrying
an accessible name, and each item keeps the tooltip it already had.

A flyout would cost an extra click per navigation to precisely the operator who
chose the compact mode. ADR 0033 already assigned that operator's speed to the
command palette (#112/#129) rather than to the sidebar, and what collapsing
actually hides is labels — which the tooltip returns. Group collapse and expand
is therefore an **expanded-mode affordance only**; honouring a collapsed group in
the rail would let a group vanish with no heading left to bring it back.

### The no-media-query rule governs layout primitives; a page shell may ask

`docs/FRONTEND.md` says layout primitives "lay themselves out **intrinsically**
with `flex-wrap` / `flex-basis` / `gap` — **no media queries**". That rule is
about `ui/layout/`, and it stands: `Sidebar` still wraps when cramped and knows
no breakpoint.

A shell choosing between a drawer and a persistent rail is not laying out a box.
It is picking a navigation *mode*, and no amount of intrinsic sizing produces a
focus trap. `useViewportMode` is the one place that asks, it lives beside the UI
preferences rather than in `ui/`, and the rule's scope is now written down —
`back-office-shell.tsx` was already shipping `md:` utilities under it, undeclared.

### Collapse has two inputs and only one of them is a preference

Effective collapse is the stored preference **or** a rail-width viewport, and the
forced value is never written back. This is the failure that no test would have
caught and that the user could not undo: a single visit at a narrow width would
silently rewrite a choice made on a desktop, and the sidebar would come back
collapsed there.

A drawer ignores the preference entirely and shows labels — the preference is
about how much room the sidebar takes *beside* the content, and in a drawer there
is no beside.

### The drawer is a `Dialog`, and it is a primitive

`Drawer` joins `ConfirmDialog` and the entity link picker in
`entifix-react-controls`, on Headless UI's `Dialog`. Focus trap, `Escape`,
backdrop click and focus restoration are the library's rather than four
hand-written behaviours that each have to be right — and a drawer that traps
focus badly is worse than no drawer, because a keyboard visitor cannot leave it.

It carries no viewport logic. *When* a drawer is the right shape is the shell's
decision; the primitive is only the shape. There is exactly one `SidebarNav` in
the tree in either mode, because rendering a second copy for the drawer is how
the two drift.

### Both "open where" choices are always visible

The workspace link loses `opacity-0` and its `!collapsed` gate, and gains an
open-in-a-new-browser-tab sibling that every destination has — not every screen
can be a workspace tab, every one can be a browser tab. Quiet rather than hidden:
muted by default with a hover and focus lift, so a permanently visible control
does not compete with the destination itself.

## Consequences

- `NavSection` carries `type`, `sidebarNav` propagates it, and `SidebarNav`
  groups on it. ADR 0033's "the sidebar does not yet render the tier" consequence
  is discharged.
- Per-group collapse state persists under one `back-office:nav-collapsed-groups`
  key rather than a key per group: `useUiPreference` resolves asynchronously
  after mount, so N keys would be N first-paint transitions.
- A collapsed group holding the active route shows its active state on the
  heading — otherwise collapsing hides where you are.
- `useViewportMode` guards on `typeof window.matchMedia !== 'function'`, not on
  `'matchMedia' in window`: jsdom declares the property and leaves it uncallable,
  so the `in` check passes and the call throws inside a passive effect.
- The drawer's open state is **derived** from the route it was opened at rather
  than closed from an effect. Closing it in an effect keyed on the pathname sets
  state during a passive effect, which is a cascading render for something that
  is a fact about the current render.
- New `shell:` copy in both locales: the drawer's open/close labels, the dialog's
  own name, and the two group toggle labels. `↗` and `▸` join the
  `react/jsx-no-literals` allow-list.

## Alternatives considered

- **Flyout submenus in collapsed mode.** What #113 assumed would be needed. It
  buys back the labels a tooltip already gives, and charges a click for them on
  every navigation in the mode chosen for speed. Rejected with the flat column
  kept instead — and if collapsed mode ever *does* nest, this is the decision to
  reopen, because then it would be strictly worse than today.
- **A container query instead of a breakpoint.** Would have kept the letter of
  the no-media-query rule. Rejected because it would keep the letter and lose the
  point: the drawer's trigger is how much room the *viewport* has, a container
  query answers about an element, and the shell's container is the viewport
  anyway. Stating the rule's real scope is more honest than routing around it.
- **Auto-collapse writing the preference.** One fewer piece of state. Rejected:
  it is silent, permanent, and unfixable by the person it happens to.
- **Deep nesting under the domain.** Rejected by ADR 0033's own reasoning and
  capped here in the type. Reach beyond three tiers is the palette's job.

## Residuals

- The rail (768–1024px) forces icons with no way to override for that session. If
  someone wants labels at 900px they must widen the window. Deliberate — the
  alternative is a second preference that only applies at one width.
- `useViewportMode` returns `wide` for the server render and the first client
  pass. A visitor on a phone sees the non-drawer markup for one frame.
