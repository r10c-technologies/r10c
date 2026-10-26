# 60. The implementation layer: cells, their granularity, and the dependency rule

- Status: Accepted
- Date: 2026-10-23
- Revised: 2026-10-24 — entifix 0.5.0 split its mixed entry points, so the review-only line below is now a ban (#321)
- Revised: 2026-10-24 — `OfferingCard` is replaced by the generic `ProductCard` in `@r10c/utils-react-ui` (#334).
- Revised: 2026-10-25 — `makeEntityRoutes` went straight to entifix 0.7.2 rather than through r10c: nine hand-written copies and the framework's own example were already the second consumer (#358 superseded by #366)
- Revised: 2026-10-26 — transaction-service's saga coordinator is a named exception that stays in its app, with the condition that would move it (#431)
- Area: entities
- Read when: adding a package under `packages/implementation/`, putting technology-bound code into a shell or an app, or a UI file imports an adapter — a cell depends on entities, use cases and ports and never on another cell or an adapter, UI and HTTP cells are keyed by domain and persistence cells by store

## Context

`docs/_shared/layering.md` declares `packages/implementation/<domain>/*` and says
the layer "holds no project today". That was true and defensible while the only
candidates were pass-through organisms `makeEntityCrud` could derive. It stopped
describing the cost once the fleet grew.

A domain's technology-bound code has to live _somewhere_, and with no layer for
it, it lives in the two places that compose:

- **In apps.** `apps/order-service/src` is 2,471 lines outside its specs —
  persistence, the outbox, routes — none of it reusable by another host, and
  seven `apps/*/src/routes/entity-crud.ts` files are the same route set written
  out by hand.
- **In per-domain shells**, which both compose a host _and_ hold its UI. A
  storefront that needs catalog and order UI cannot import the order shell (one
  domain shell never imports another), so it can only compile by absorbing
  everything into `shells-next-marketplace`.

And the place where a UI file reaches a mechanism is unmarked: six shell UI
files build a metadata source with `@entifix/rest`, and nothing could say they
should not, because the only rule in force was direction.

## Decision

### A cell is one key wired to one technology

Cells live at `packages/implementation/<key>/<tech>`, named
`@r10c/implementation-<key>-<tech>`, and are **created on demand** — the first
code that needs one creates it, and no cell exists for symmetry.

| tech                    | keyed by   | why                                                                                                                                                 |
| ----------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react`, `next`         | **domain** | a screen renders a domain's entities, whichever stores they come from                                                                               |
| `http`                  | **domain** | a route set serves a domain's use cases                                                                                                             |
| `mongo`, `redis`, `sql` | **store**  | a persistence cell implements ports over **one** database handle, so its key is the thing the handle opens — the store, with its engine as the tech |

So the `auth` store's binding is one `mongo` cell even though it hosts three
domains (the binding [ADR 0020](0020-stores-and-slices.md) records), and
marketplace-service, which owns `catalog-reference` and `published-catalog`,
gets two. `session` and `saga-coordination` are `redis` cells;
`configuration` is a `sql` one.

### The rule: entities, use cases and ports — never another cell, never an adapter

A cell may depend on entities, use cases and ports, from the business layer and
from entifix. It may not depend on another cell, and it may not depend on an
adapter. The distinction that decides every case:

> The technology a cell is **written in** is allowed. The mechanism it **talks
> through** is not.

A `react` cell is written in React and imports `react-controls`; it talks to
the catalog through `EntityRepositoryTag`, and which adapter answers is the
shell's business. A **persistence cell is the exception by construction**: it
_is_ the adapter, so it may import its own engine's entifix client and driver —
and nothing for UI or HTTP.

Cell→cell is already a build failure and needs no new rule:
`layer:implementation` may depend only on `layer:business` and `layer:utils` in
`eslint.config.mjs`, with no same-layer edge — unlike `shell` and `business`,
which allow one and order it.

**Allowed in a non-persistence cell:** `@entifix/core`, `@entifix/business`,
`@entifix/authz`, `@entifix/i18n`; `@entifix/react-controls` but not its
`/i18next` subpath; the `.` entries of `react-integration`, `next-shell` and
`service-shell`.

**Composition-only** — a shell or an app may import these, a cell may not:
`@entifix/{rest,static,mongo,sql,redis,amqp,jwt,zitadel,posthog}`,
`@entifix/react-controls/i18next`, `@entifix/next-shell/server`, every datastore
driver, `@tanstack/*` and redux.

**The mechanism halves of three entifix packages are composition-only too**:
`@entifix/transactions/engine`, `@entifix/service-shell/{runtime,observability,testing}`
and `@entifix/react-integration/event-source`. Until entifix 0.5.0 they shared
the `.` entry with their contracts, so banning the specifier would have banned
the contract with it and the rule was review-only there; 0.5.0 split them and
#321 made the ban real. The reasoning for why a mechanism must have a specifier
of its own is entifix's
[ADR 0006](https://github.com/r10c-technologies/entifix/blob/main/docs/adr/0006-the-public-contract-is-entities-use-cases-and-ports.md),
which this record narrows to r10c's layering rather than restating.

### Generic asset, then binding, then the escape hatch

The default way to build a cell is to **bind a metadata-driven generic asset to
an entity**, the way `makeEntityCrud` already derives a CRUD screen. Its backend
twin is `makeEntityRoutes`, in `@entifix/service-shell` since 0.7.2; the seven
hand-rolled `entity-crud.ts` files are what it replaced. A hand-written component or route
stays first-class wherever the generic one does not fit.

A new generic asset is **incubated in r10c and promoted to entifix when a second
consumer needs it** — before that, nobody can tell which half is generic.

> 2026-10-25: `makeEntityRoutes` skipped the incubation, and the rule is why it
> could. The point of waiting for a second consumer is to see which half is
> generic; nine copies of the same routes across the fleet, plus the
> framework's own example service writing them a tenth time, had already shown
> it. Promotion's condition was met before the asset existed. An
incubated asset cannot sit in a shell, because a cell cannot import one, so it
lives at `layer:utils, scope:shared`, one package per technology, and carries
the same `tech:*` bans a cell of that technology does.

### Scope: a cell belongs to its domain

A cell carries a **domain** scope, never `scope:shared`: it is not reusable core,
it is one domain's code in one technology. A second host reaches it by widening
the **host** scope — exactly how `scope:back-office` already reaches the stock,
order, sales and settlement shells — so the domain gains nothing by being
mounted twice. Which tag values the existing scopes map to is #310's to decide.

A need that crosses domains goes through a `business:policy` contract, never
through another domain's cell.

### What a shell is now

A shell is **composition per host**: it provides the adapters, mounts the cells
and owns the routes and pages that place them. Code moves out of shells into
cells as each cell is created, not in one migration. `OfferingGrid` stays in
`shells-next-marketplace` until the storefront rebuilds it, and the shell's own
`OfferingCard` is gone: the grid renders the generic `ProductCard` from
`@r10c/utils-react-ui` (#334).

### The one exception: the saga coordinator stays in its app

transaction-service's coordinator — the `POST /api/saga/:definition` run
route, the instance and tracker reads, the HTTP dispatcher and the resume and
recovery sweeps — is not in a cell, deliberately. It is the composition of
`@entifix/transactions/engine` (`runSaga`, `resumeSaga`), and `tech:http`
bans that subpath for every cell, rightly: a cell must not choose the engine.
The slice also declares no domain to key an HTTP cell by — that is why the
route is generic rather than `/api/checkout`.

So it stays composition, in the one host that coordinates, and its route files
carry specs of their own even though app code sits outside the coverage gate.
**The condition that changes this is a second coordinator host.** Two
processes composing the same engine over the same routes would be the second
consumer this record asks for before code is lifted, and the cell they share
would be keyed by the `saga` store rather than by a domain.

### This amends ADR 0008

ADR 0008 rejected "pushing domain modules down to `layer:implementation`" as a
larger refactor with no different outcome. For route and auth primitives that
judgement holds; for technology-bound domain code the outcome is now different,
and this record adopts it. It also narrows what `shell:domain` means, from a
domain's module to a host's composition. Its `shell:` and `host:` dimensions and
its three forbidden couplings are unchanged.

## Consequences

- **The layering text becomes false**, and #310 rewrites it together with the
  `tech:*` dimension and its per-technology bans; `@r10c/docs-check` will assert
  every implementation project carries exactly one `tech:*` and a scope.
- **A UI file importing an adapter becomes a build failure** once a cell holds
  it — the six metadata-source call sites stop needing review the moment they
  live in a cell.
- **Two packages per domain are the expected steady state**, not a smell: a
  domain with a screen and a route set has a `react` or `next` cell and an
  `http` cell, plus one persistence cell per store it owns.
- `packages/implementation/product-configuration-management/react/` exists on
  some checkouts holding only `node_modules`; it is untracked, and #310 deletes
  it before the first real cell.
