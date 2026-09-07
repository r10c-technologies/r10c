# 44. The command palette owns no index, and its depth is a page stack

- Status: Accepted
- Date: 2026-09-06
- Amends: [ADR 0035](0035-entity-actions-selection-and-bulk.md) (its `unbound`
  cell now has a renderer **and** a producer; the nine-cell map itself stands
  unchanged).

## Context

[#112](https://github.com/r10c-technologies/r10c/issues/112) designed a palette
and [#129](https://github.com/r10c-technologies/r10c/issues/129) asked for it.
The interesting thing about both is what they were waiting on, and that three
of the four things had already landed and were **being called by nothing**:

| Source       | Before this record                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| Records      | `GET /api/search` + `searchRecords` shipped with #130 — **zero callers**       |
| Destinations | `visibleNav` shipped with #125 — one caller, the sidebar                       |
| Commands     | `'command-palette'` in `ACTION_SURFACES` since #118 — **no renderer, no verb** |
| Open tabs    | `useTabsState` — the workspace's own                                           |
| Wizards      | Do not exist ([#128](https://github.com/r10c-technologies/r10c/issues/128))    |

So the palette is not new machinery on top of the fleet. It is the consumer that
closes three loops, and the third of them is a live instance of the exact fault
ADR 0035 was written about: `unbound` was a vocabulary member with a mapped
surface, no producer, and no test that could tell the difference.

## Decision

### The palette holds no index, and there must never be one

Every result comes back from a guarded endpoint on the keystroke that asked for
it. ADR 0040 forecloses a prefetched client index permanently, and this record
does not reopen it: an index is the shape that surfaces another organization's
record the first time a session's scope moves underneath it, and it fails
_silently_, which is what makes it worse than a slow search.

The palette therefore owns the **keystroke** policy — debounce, abort, the
two-character floor — and `/api/search` owns the fan-out, the per-source timeout
and the authorization. `searchRecords` stays a bare typed `fetch` between them.

### Nothing is ranked across groups; recency reorders within one

Group order is the declared order, which is ADR 0040's ruling and #112's
independently. Recency is the one thing added: within a group, the option you
last ran comes first, stored as **one keyed record** in `UiPreferencesState`
(the `back-office:nav-collapsed-groups` precedent — N keys are N first-paint
transitions).

⚠️ **Record groups are deliberately exempt.** Their option ids are record
primary keys, so ranking them would build a list of which records a person
opened inside a UI preference, for a convenience nobody asked for.

### The grammar is for entry; depth is a page stack

`>` narrows to commands and actions, `#` to records, anything else searches
everything. Descending — "Nuevo…" becoming an entity picker — is a **pushed
page**, not a third prefix: a prefix has to be remembered, a list can be read.
`Escape` pops one level and closes at the root, `Backspace` on an empty term
pops too.

It ships **with a consumer**. Every create command declares
`page: NEW_COMMAND_PAGE` and the root synthesizes the single entry that opens
it — synthesized rather than declared, because no shell can know whether another
shell also contributed one and two declarations would render the opener twice.
Building the stack with nothing to put in it would have repeated this record's
own opening complaint.

### A degraded source is named, with two severities

`CommandGroup.unavailable` carries `{ message, severity }`, where `severity`
splits ADR 0040's `reason` vocabulary into the two things it must not conflate:

| `scope` — the caller's ordinary state                  | `reachability` — something is wrong                            |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `forbidden`, `noActiveOrganization`, `unauthenticated` | `timeout`, `network`, `invalidQuery`, `notFound`, `unexpected` |

An operator holds no membership, so every tenant-plane source answers `409` on
every keystroke. Painting that as an outage teaches them to ignore the row, and
then the `timeout` that does matter goes unread. `scope` renders muted,
`reachability` in the danger tokens.

The **below-the-floor** state uses the same slot rather than an empty group: an
empty group claims nothing matched a search that never ran, and an absent one
leaves someone wondering whether records are searchable at all.

### Both shortcuts are bound, and neither is load-bearing

#112 argued for ⌘⇧P because Chrome and Firefox claim ⌘K for address-bar search.
That is half the picture — **⌘⇧P / Ctrl+Shift+P is Firefox's private window**, so
both candidates collide somewhere — and ⌘K is what Linear, GitHub, Slack and
Vercel trained people on, so leaving it unbound costs a reflex.

So `useHotkey` binds both and `preventDefault`s each, and the top bar carries a
**permanently visible trigger**. Whichever chord a given browser swallows, two
other ways in remain. This is the repo's first global shortcut; the hook also
decides, once, that a page-wide listener stays out of the way while focus is in
an editable element.

### The sources filter; the control renders

`CommandSource` in `entifix-ts-core` is state — groups, options, `isLoading`,
`unavailable` — produced by hooks in the shell layer and consumed by a
presentational `CommandPalette` in `entifix-react-controls`. Exactly
`EntityLinkSource`'s arrangement, and for the same boundary reason: those two
packages are both `entifix:react` and may not import each other.

Filtering belongs to the sources because a record group is filtered by the
service that answered it. A control that filtered again would need to know which
groups were pre-filtered, and would silently empty a group that answered a
_different_ term instead of showing it as stale.

Matching is **subsequence, accent-folded, unscored**. ⚠️ The fold is
correctness, not polish: the fleet's default locale is Spanish, and without it
`categoria` does not match `Categoría` — the palette would find nothing for the
most natural way to type most of its own copy.

### `sign-out-others`: a real unbound verb, not one invented to fill the cell

`POST /api/auth/sessions/revoke-others` has existed since sessions were built,
is proxied through this host, and **had no caller** — the account screen only
revokes one row at a time. So the verb was already implemented and simply
unreachable.

It is genuinely `unbound` — no record, no selection, the subject is the caller —
and it makes ADR 0026's binding axis legible beside its sibling:
`revoke-sessions` is `binding: 'entity'` (an administrator ends _somebody
else's_ sessions, incident response), `sign-out-others` is `unbound` (you end
_your own_). Same entity, same domain; the binding is what says whose.

Two consequences worth stating plainly:

- The auth-service route moves from `requirePrincipal` to
  `requirePermission(SIGN_OUT_OTHERS)`, so the grant is real authorization
  rather than a filter on an affordance the route ignores.
- ⚠️ **Every role holds it**, because ending your own sessions is a control the
  account owner must always have rather than an administrative capability. A
  role added later that omits the grant loses self-service, and `@r10c/slices`
  will not catch it — it only checks that a declared verb is granted
  _somewhere_.

It sends no notification, unlike its sibling: the person who did it is the
person reading, and mailing them about their own click is the noise that trains
people to ignore the security mail that matters.

### A declared verb with no handler throws

A host registers `handlers` per entity beside the metadata source. A descriptor
that reaches the palette with no handler fails at the **first render**, not on
the click. A verb that appears and does nothing reads as a broken feature rather
than a missing wire — the posture `assertSearchable` and `surfaceFor` already
take.

## Alternatives rejected

**A prefetched client index.** See above, and ADR 0040. Permanently out.

**Fuzzy scoring across groups.** Clever, unpredictable, and it takes away the
one thing that makes a palette fast: knowing where a result will land before it
appears.

**⌘⇧P alone, as #112 specified.** It collides with Firefox's private window, and
it leaves the chord most people actually reach for unbound.

**A nested prefix for depth.** A page stack is readable; a second grammar
character has to be taught.

**Deferring the page stack until a wizard needs it.** Rejected because the
create commands are a genuine consumer today, and a mechanism with no
declaration is what this record opens by complaining about.

**Inventing an unbound verb to exercise the cell.** Also rejected — and not
needed, because a real one was sitting unreachable.

## Measured on the live fleet

The shortcut claim is stated from a real pass rather than from #112's
assumption: in Chromium both ⌘K and ⌘⇧P reach the page and `preventDefault`
holds. Firefox is the browser that reserves one of each pair, which is why both
are bound and why the trigger exists rather than being a courtesy.

Both severities were seen in one list, which is the picture the split is for: an
operator with no membership got **"Not available here: Select an organization to
continue."** on the tenant-plane product source, muted, while marketplace-service
was down and its two sources read **"We could not reach this source: Network
error."** in the danger tokens. One dead service cost two named groups and
nothing else.

Two defects the pass found, both invisible to the suites that were already
green:

- The nav source used the **section title as the hint** when a section declared
  no screen type, so the untyped account section rendered "Perfil · Cuenta ·
  Cuenta" — the title is already the sublabel. An untyped section now hints
  nothing.
- `shell.commandPalette.groups.records` shipped as `'Registros'` in **both**
  catalogs, so the English palette had one Spanish heading. `@r10c/i18n-check`
  cannot see this and is right not to: parity is about keys, and a value that is
  merely the wrong language is a key that resolves.

## Consequences

- An operator reaches any permitted destination, record, open tab or command
  from the keyboard, and a source that is slow, down, forbidden or out of tenant
  scope degrades to one **named** group rather than a missing or silently empty
  one.
- `GET /api/auth/sessions` (POST) gains its first caller, and
  `authn:user-identity:sign-out-others` its first grant — held by every role.
- Adding a searchable record source is still a `defineRecordSearchSource` call;
  adding a command is a `GuardedCommand` in the shell that owns the screen it
  leads to, filtered by the host through `isNavItemVisible` itself rather than a
  second rule that could disagree with it.
- `BackOfficeShell` gains a `commandPalette` slot rather than building one. The
  palette's use-case sources carry entity constructors and handler functions,
  neither of which survives the server→client boundary as a prop, so the host
  composes it in a client module of its own — which also keeps `shell:base` from
  naming any domain's entities.
- ⚠️ One coverage exemption is recorded in the palette: Headless UI types its
  `onChange` as nullable, and this combobox is driven entirely from the outside,
  so the library never produces the `null` its type admits. The guard stays
  because the contract is the library's; the ignore is written beside it with
  that reason.
- Wizards contribute nothing yet, by construction — #128 has not been built.
  When it is, it is a source, not a change to the palette.

## Related

- [ADR 0040](0040-the-record-search-aggregator.md) — the fan-out this reads, the
  index it forecloses, and the ranking rule it inherits.
- [ADR 0035](0035-entity-actions-selection-and-bulk.md) — the nine-cell surface
  map whose `unbound` row this finally renders.
- [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md) — the
  served, permission-filtered descriptors the command group reads.
- [ADR 0037](0037-entitlement-aware-navigation.md) — the two ceilings a command
  is filtered by, shared with navigation rather than restated.
- [ADR 0042](0042-the-workspace-address-is-the-taxonomy-serialized.md) — the
  `?tab=` address an open-tab result and an "open in workspace" command deep-link
  to.
