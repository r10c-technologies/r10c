# 71. Http cells hold descriptors, and the slice shell builds the API

- Status: Accepted
- Date: 2026-10-29
- Area: platform
- Read when: adding a route, a verb or a guard, or an `http` cell reaches for `effect/http` — a cell declares, the slice shell serves, and `exposedAPIs` is checked

## Context

[ADR 0060](0060-the-implementation-layer-cells.md) defines an `http` cell as "a
route set". Every one of the eleven was an `HttpRouter` value built by hand,
with the guards wrapped around each handler and the error bodies written next
to them:

- `routeFailure`, `instanceof EntifixBuildError` and ad-hoc `{ error, code }`
  JSON decided statuses inside the cells, which
  [ADR 0064](0064-failures-reach-the-slice-shell.md) says only the slice shell
  may do;
- links to verbs were written by hand (`recordLinks`, `offeringLinks`) and could
  drift from the routes they pointed at;
- several verbs were hand routes with paths of their own —
  `POST /api/product-order/:id/cancellation`, `POST /api/counter-sale`, brand
  and category `retire` and `restore` — although each is, or should be, a
  `@useCase()` on its entity;
- `exposedAPIs` in `tools/slices/` was diffed only by a live script
  (`tools/fleet-map.mjs`), so a slice could serve a route its declaration did
  not name and nothing failed.

entifix 0.12.0 makes an endpoint a Schema descriptor and lets the shell build an
`HttpApi` from them ([entifix ADR 0020](https://github.com/r10c-technologies/entifix/blob/v0.12.0/docs/adr/0020-endpoints-are-descriptors-and-the-shell-builds-an-httpapi.md)):
one encoder, one middleware per guard kind, derived verbs and links, and an
entity's endpoints declared with `defineEntityApi` in `@entifix/business`, with
no HTTP in the declaration.

## Decision

### A `tech:http` cell exports descriptors, handlers and declarations

A cell under `packages/implementation/<domain>/http` exports three kinds of
value and nothing else:

- **endpoints** — `defineEndpoint` descriptors from `@entifix/core`, each
  implemented with `implement(descriptor, handler)`, for what is not an
  entity's generic CRUD (a lookup, a participant call, a public flow route);
- **entity declarations** — `defineEntityApi(Entity, key, { verbs, guard,
narrowing, facets, prepare, override, useCases })` from `@entifix/business`;
- **verbs** — `verbEndpoint(UseCase, { guard, idempotent, handler })`, one per
  `@useCase()` the entity declares.

A handler fails with the domain's typed failures and never names a status. It
imports nothing from `effect/http`, `effect/http-api`, `@entifix/service-shell`
or `@entifix/rest`.

### The slice shell builds and serves the API

The slice's `@r10c/shells-effect-<slice>` turns the cell's values into groups —
`endpointGroup(name, ...endpoints)` and `entityApi(declaration, {
compositions })` — and exports them as `endpoints`, with the slice's
`FailurePolicy` as `policy`. The app hands both to `makeService`, which builds
one `HttpApi`, serves it beside health, `$service` and `$openapi`, and encodes
every failure as a problem under that policy. A status that differs from the
category's default — a declined capture answering `402` — is a row in the
policy, written once.

The fleet's own endpoints — `GET /api/config` (public, every secret redacted)
and `GET /api/me` (session) — are a group `@r10c/shells-effect-service`
contributes to every slice through `serviceBaseGroup({ service, store })`.

A held-open stream is not an endpoint: transaction-service's server-sent events
stay a raw route under `makeService`'s `router`, as entifix ADR 0020 allows.

### Verbs are derived, and their paths follow from that

A verb is `POST /api/<key>/:id/<useCase>` for an entity binding and
`POST /api/<key>/<useCase>` for a collection one, and its link is built from
the same declaration. So:

| Was                                        | Is                                                |
| ------------------------------------------ | ------------------------------------------------- |
| `POST /api/product-order/:id/cancellation` | `POST /api/product-order/:id/cancel`              |
| `POST /api/counter-sale`                   | `POST /api/sales-channel/:id/sell`                |
| hand `POST /api/<brand\|category>/retire`  | derived from `@useCase({ key: 'retire' })`        |
| hand `POST /api/<brand\|category>/restore` | derived from a new `@useCase({ key: 'restore' })` |

`publish` and `unpublish` keep their shape; they were already the derived one.
`/cancelling` and `/cancelled`, the saga's own steps, are endpoints with a
crossing guard rather than verbs, because no person reaches them.

### What checks it

- **The `tech:http` ban.** Every `tech:http` cell's `bannedExternalImports`
  adds `effect/http`, `effect/http-api`, `@entifix/service-shell` and their
  subpaths, beside the adapters it already banned. `@r10c/conventions` plants a
  violation and fails if the rule stops catching it.
- **`exposedAPIs` parity.** `@r10c/slices` asserts that the `METHOD path` set
  each active slice's shell serves equals its declaration's `exposedAPIs`, and
  that every `dependantAPIs` entry exists in its target's set. A planted extra
  endpoint and a planted missing one each fail it.

## Consequences

- A status, an error body and a link are written in one place — the shell's
  policy, the problem encoder and the declaration — so a cell cannot drift from
  them.
- The OpenAPI document and the typed client come from the same descriptors the
  server is built from.
- The migration lands **one commit per slice** inside one pull request, not one
  pull request per slice: there is no interim tag marking which cells are
  migrated, and the ban and the parity check cover every slice from the commit
  the last cell moves in.
- A route a person reaches and a route a saga reaches stay distinguishable by
  their guard: `session`, `permission` or `organization` for the first,
  `crossing` for the second, and never both on one endpoint.
