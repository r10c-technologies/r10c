# 21. Consolidating the fleet into five deployments

- Status: Accepted
- Date: 2026-08-12

## Context

[ADR 0020](0020-stores-and-slices.md) named the **Store** and the **Slice** and
recorded three invariants, then left them as prose — along with three of its own
findings still open in the code. Reading the fleet against its own definitions
turned up something else: **eight deployments for zero traffic**, two of which
were not Slices at all under the new definition.

- `marketplace-service` was 36 lines across two files: a `makeService` call and
  an `AppLayer` that provided nothing. No router, no store, no domain. The
  storefront never called it; the seed row pointing at `:3100` had no code
  consumer at all.
- `transaction-manager` was a 329-line passive consumer — subscribe to the fanout
  exchange, fold each event into a record, sweep for stalls.
  marketplace-admin-service already provides the same `AmqpLayer` +
  `AmqpEventBusLayer` and publishes the very events being tracked.
- `auth-app` and `marketplace-admin-app` were two Next processes on two origins,
  joined by an `AUTH_APP_URL` environment variable, absolute cross-app account
  links, and a redirect dance whose only purpose was to move a cookie between
  ports that already shared it.

ADR 0008 allocated `300N` / `310N` to frontend/backend **pairs**, which is the
assumption that made a domain without a frontend look like a gap.

## Decision

**Eight deployments become five.** No new mechanism: ADR 0020 already says a
Slice is _"realized as **one or more** deployments"_, so consolidating needs a
register that can record co-deployment, not a new decision about what may share
a process.

### The distinction the whole record rests on

> Co-deploying two **slices** is reversible. Merging two **stores** is binding.

Ownership does not move when a process is shared: each slice still writes only
the stores it owns, and splitting back out is a matter of pointing a declaration
at a different app. Merging two domains into one store is a data migration, and
ADR 0020 already requires it to be recorded with its cost.

The test, applied after every merge below: **can you still name the one slice
that writes each store, without reading code?**

### 1. The invariants become tests

`tools/slices/` holds the register as typed declarations, and `slices.spec.ts`
checks them against the source tree. A store is declared _inside_ its owning
slice, so "exactly one writing Slice" is structural rather than an `owner` string
two declarations could both claim.

Entity domains are read by scanning `@entity({ domain })` in source rather than
through `Symbol.metadata`, deliberately: metadata is only reachable through a
package's barrel, so an entity that exists but was never exported would be
invisible and the invariant would pass vacuously. A guard asserts the scan found
what it is meant to check, so a regex that stops matching fails loudly instead of
turning the suite green.

Running it immediately surfaced a gap in the prose register: `access-management`
owns `role`, `membership` and `entitlement`, and auth-service seeds all three
into the `auth` store — which the register listed as hosting only `authn` and
`party-management`. The `auth` store therefore binds **three** domains, not two.

### 2. `marketplace-service` is deleted

Not a Slice, and a placeholder deployment still has to be booted, probed, built
in CI and reasoned about at every step. [ADR 0009](0009-catalog-authoring-and-publication.md)
recreates the backend under its own name — `published-catalog` — when there is a
published catalog to serve. Frees `:3100`.

### 3. The `transaction` slice is co-deployed, not merged

It still owns the `saga` store and nothing else; the catalog still owns `catalog`
and nothing else. One process, two owners, both recorded in `coDeployedWith` —
and the spec fails if only one side records it.

What made this safe was a fix that had to come first. `MongoDatabaseTag` is a
single Tag, so two Mongo stores in one process would have meant whichever layer
won the merge silently decided where the other one wrote. `MongoTransactionStoreLayer`
now resolves its `Db` from the pool (`MongoClientTag`) plus an explicit
`SagaDatabaseName`, so the saga store stops being "whatever the ambient database
tag holds" and becomes a named handle that moves to another process unchanged.

The router moved with it: `GET /api/transaction{,/:id}` is what the catalog's own
`202` points clients at, so deleting the app without those routes would have
broken the accept-then-poll contract rather than removing a deployment. The
`rel: 'status'` href is relative now, so callers never encoded either
arrangement. Frees `:3103`.

### 4. One back office, two domain shells

`marketplace-admin-app` becomes `back-office-app` and mounts `shells-next-auth`
beside `shells-next-marketplace-admin`. Renamed because keeping the old name on a
host that serves the account and user-administration surface is exactly the
naming dishonesty ADR 0020 exists to remove. Frees `:3002`.

**The shell was extracted before the merge, on its own commit.** That ordering is
the decision, not an implementation detail: Nx boundaries govern cross-project
edges only, so merging two apps' directories would have deleted a
compiler-enforced boundary and demoted it to convention. With the shell in place
the `scope:auth` ↮ `scope:marketplace-admin` edge survives co-hosting, and
splitting auth back out is a new app mounting that shell.

The host carries a new **`scope:back-office`** tag, which may compose
`scope:marketplace-admin` + `scope:auth` + `scope:shared`. This is the tag-level
form of ADR 0008's _"page-level aggregation across domains belongs in the RSC"_.
The rule is not weakened: neither domain shell carries the tag, so they still
cannot reach each other — only the host that mounts both does.

Copy follows code. An `app:` key is lint-restricted to `apps/`, so the seven
blocks the shell renders moved to `shell:auth.*` in both locales; what stayed in
`app:auth` is the sign-in page, which is the host's own front door rather than
the domain's surface.

Three route groups, because they **gate** differently rather than look
differently: `(authenticated)` needs a session, `(back-office)` also demands
`authn:user-identity:read`, and `(account)` deliberately demands nothing more
than a session — your own account is not an administrative screen. All three
compose one `BackOfficeChrome`, which keeps that a difference in gates rather
than three drifting copies of a layout.

### 5. Three hosts stay standalone, on purpose

- **config-service** is the fleet's boot dependency: every other slice resolves
  its parameters from it before it can open a connection. Co-deploying it into a
  domain host inverts the boot graph.
- **auth-service** is the URL Zitadel calls back into (back-channel logout and
  Actions v2 events, both server-to-server from inside the cluster).
- **marketplace-app** has a different rendering contract — prerender + ISR per
  locale, against the back office's `headers()`-forced dynamic rendering — and is
  the only host that will ever see anonymous traffic.

### 6. The port index becomes per host, not per pair

Consolidation breaks ADR 0008's pair allocation regardless. A domain still owns
its `-service` index; what it no longer implies is a frontend of its own.

## Consequences

|                       | Before                                     | After                      |
| --------------------- | ------------------------------------------ | -------------------------- |
| Deployments           | 8                                          | 5                          |
| Next apps             | 3 (`:3000`, `:3001`, `:3002`)              | 2 (`:3000`, `:3001`)       |
| Services              | 5 (`3100`, `3101`, `3102`, `3103`, `3190`) | 3 (`3101`, `3102`, `3190`) |
| e2e projects          | 6                                          | 4                          |
| ADR 0020's invariants | prose                                      | executable                 |

**What this buys beyond fewer processes.** Sign-in now happens on the origin that
serves everything behind it, so the cookie hop, the `AUTH_APP_URL` indirection
and the absolute cross-app account links all disappear — `accountUrls` is deleted
along with the cross-origin case it existed for.

**What it costs.** `ZITADEL_SEED_REVISION` goes 4 → 5 and the OIDC redirect moves
to `:3001`; the config seed is `ON CONFLICT DO NOTHING`, so anyone pulling this
needs `pnpm run back-office:dev:reset` or sign-in fails against a stale redirect
row. Two domains now share a Next process, which is a thing to undo deliberately
rather than a thing that cannot happen.

**What supersedes what.** ADR 0008's host table and its `300N`/`310N` pairing are
superseded by [ports](../_shared/ports.md). The `transaction` slice's entry in
[planes](../_shared/planes.md) gains a co-deployment column. ADR 0008's
one-writer-per-database rule is untouched — it is the rule this record spent its
effort _not_ breaking.
