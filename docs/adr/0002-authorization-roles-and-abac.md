# 2. Authorization: role aspects behind an ABAC-shaped port

- Status: Accepted
- Date: 2026-07-24
- Revised: 2026-08-13 by [ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md) —
  records here the "supersedes ADR 0002 on RS256 only" that ADR 0015 declared but
  never wrote back. `jwt.secret` is gone; verification takes a public key.
- Revised: 2026-08-13 by [ADR 0016](0016-zitadel-authenticates-r10c-authorizes.md) —
  `registerUserUCFactory` no longer hashes anything. The role model, the
  entity-derived permissions, `canAssignRole` and the three enforcement layers are
  untouched and still binding.
- Amended by: [ADR 0037](0037-entitlement-aware-navigation.md) — nav filtering
  gained a second ceiling (the organization's provisioning) and lost the
  `/api/menu` endpoint this record's consequences named. The three enforcement
  layers are untouched: the new filter is layer 2, and still not security.

## Context

The v1 auth layer ([Auth: sessions + tokens](../ARCHITECTURE.md#auth-sessions--tokens))
delivered **authentication only**. Its seams for authorization existed but were
empty: `AuthSubject`/`Principal` carried `roles`/`attributes`,
`TokenClaims` carried `roles`, and yet `authSubjectFromUser` hardcoded
`roles: []`. `requirePrincipal` answered "is there a valid token", never "may
this caller do this". The admin sidebar was hardcoded in two independent places
and every catalog route on marketplace-admin-service was open.

The product requirement is three user tiers:

| Role          | marketplace-admin-app              | auth-app                                       |
| ------------- | ---------------------------------- | ---------------------------------------------- |
| `user`        | reads the catalog                  | sign in / sign up only — no back-office        |
| `admin`       | reads + authors the catalog        | back-office: list/create/edit users (≤ admin)  |
| `super-admin` | catalog + future developer tooling | back-office: everything, can mint super-admins |

> **Revised 2026-08-13.** Both column headings name hosts that no longer exist:
> `marketplace-admin-app` and `auth-app` were merged into **`back-office-app`**
> (`:3001`), which mounts `shells-next-marketplace-admin` and `shells-next-auth`
> at one origin. The two columns are now two shells inside one app; every role
> row is otherwise unchanged, which is the point — the merge moved processes, not
> permissions. Later references to "auth-app" in this record read the same way.

Sidebar contents must follow from the signed-in user's aspects, and Admins must
be able to create more Admins.

## Decision

### RBAC now, behind an ABAC-shaped port

`PolicyDecision.decide({ subject, resource, action, context })` is the only
authorization API call sites see. Its **v1 implementation is a static
role→permission table** (`makeStaticPolicyDecision`), which reads only
`subject.roles`, `resource` and `action`. `resource` attributes and `context`
are in the signature from day one, so adopting a real rule engine is a change of
the `Layer` that provides `PolicyDecisionTag` and touches no guard, page or nav.

Rejected: shipping a rules engine now (ceremony with no payer for three ordered
tiers), and scattering bare `role === 'admin'` comparisons (no seam at all).

### Permissions are derived from entity metadata

A permission is `` `<domain>:<entityKey>:<action>` `` — the same `domain`/`key`
already declared on every entity via `@entity({ domain, key })`. `*` in any
segment of a **granted** permission is a wildcard. `permissionForEntity(Ctor,
action)` reads the metadata directly, so making a new entity guardable requires
no new vocabulary.

This mirrors the existing rule that a member's `filterable`/`sortable` metadata
_is_ the server-side query allowlist: the entity keeps describing itself, and
guards, nav items and UI all read one vocabulary.

### Grants are derived from roles, not embedded in the token

The access token keeps carrying only `roles` (it already did). Every consumer
expands roles into permissions through the shared `ROLE_PERMISSIONS` table.

Rationale: the token stays small, there is one source of truth, and editing the
table takes effect on deploy rather than after every issued token has expired.
The cost — a role change is invisible to already-issued tokens for up to the
15-minute access TTL — is bought back by **revoking that user's sessions when
their role or status changes** (`session:user:{id}`), which makes a demotion
immediate.

### The role is a field on `UserIdentity`

`role: Role` with `@accessor({ type: 'enum', enumValues: Roles, … })`, not a
separate `Role` entity with an editable permission list. It renders for free in
`EntityTable`/`EntityForm`, is filterable/sortable server-side in one line, and
rides into `AuthSubject.roles` at the single existing projection point. Custom,
user-defined roles are deferred until something actually needs them.

### Escalation rule: assign at or below your own tier

`canAssignRole(actorRoles, target)` compares `ROLE_RANK`. An Admin mints Users
and Admins but never a Super-Admin; public signup passes no actor and is pinned
to `user`, ignoring any caller-supplied role. Creating a user therefore goes
through `registerUserUCFactory` (hashing + identifier uniqueness + this guard),
never through a generic entity write.

> **Revised 2026-08-13.** The hashing half is gone:
> [ADR 0016](0016-zitadel-authenticates-r10c-authorizes.md) moved the credential
> to Zitadel, so `registerUserUCFactory` does identifier uniqueness and this
> guard only. That it is still the one path to a new user is unchanged and still
> load-bearing — the `canAssignRole` ceiling lives inside it, so a generic entity
> write would route around the ceiling, not just around the hashing.

### Presentation may read the token unverified; decisions may not

Filtering navigation needs the caller's roles on every server render. Verifying
the token there would mean copying `jwt.secret` out of config-service into the
Next runtime; calling a service instead would put a network hop on every render
of every page.

> **Revised 2026-08-13 by [ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md).**
> There is no `jwt.secret` any more: tokens are RS256, auth-service alone resolves
> `jwt.privateKey`, and everyone else gets `jwt.publicKey` + `jwt.keyId` — which
> is served openly at `/.well-known/jwks.json`, so verifying in the Next runtime
> would leak nothing. The **decision below still stands**, on the second reason
> alone: `unverifiedRoles` is about not paying to verify on every render of every
> page, not about secret distribution. Keeping it also means the one place that
> _must_ be right (`requirePermission`, on the service) stays the only verifier.

So `unverifiedClaims` (`entifix-ts-jwt-client`) decodes the cookie **without
checking its signature**, and is used only where being wrong costs a menu item.

> _Revised 2026-09-02 ([ADR 0037](0037-entitlement-aware-navigation.md)):_ this
> paragraph said `unverifiedRoles`, a roles-only helper over the same primitive.
> The nav now needs the roles, the organization and the entitlements from one
> cookie, so it decodes once with `unverifiedClaims` and the helper was deleted
> with its last caller. The mechanism and the warning are unchanged.
> The name is blunt and the warning is at the definition, because the failure mode
> if someone reaches for it in a real decision is silent. auth-app's back-office
> gate — which decides whether to render user management at all — does the
> opposite: it resolves the principal from auth-service `/api/me` and fails closed
> when it cannot.

### Three enforcement layers, one of which is security

1. **Next middleware** — cookie presence, a fast bounce. Not a check.
2. **Server-rendered layout / menu** — filters nav items with `can(...)` and
   gates the auth-app back-office. This is UX, and it is where the role gate
   lives rather than in middleware, because verifying the JWT at the edge would
   mean copying `jwt.secret` out of config-service into the Next runtime.
   _Revised 2026-08-13: RS256 means the edge would only need the public key, so
   that reason lapsed — see the blockquote above. The layer placement stands; the
   gate now lives in back-office-app's `(back-office)` route group._
3. **Service guard `requirePermission`** — verifies the token, then asks
   `PolicyDecisionTag`. `401` unauthenticated, `403` authenticated but denied.
   **This is the boundary**; hiding a menu item without it protects nothing.

### Package placement

New `@r10c/business-ts-authz` (`layer:business`, `scope:shared`), depending only
on `entifix-ts-core`. `can`/`permissionMatches`/the role table are pure and
Effect-free so the identical check runs in a service, in a Next server
component, in edge middleware and in the browser; only `PolicyDecisionTag`
imports `effect`. The shared guards live one layer up in
`@r10c/shells-effect-service`, which both services already depend on.

This required a **new `business:*` tag dimension**. `business-ts-authn` has to
import the role vocabulary to give `UserIdentity` a role, and that is a
same-layer edge the `layer:*` dimension alone can only forbid entirely or permit
entirely. Rather than weaken the rule, the business layer gained the ordering
dimension `entifix:*` already gives the framework layer: `business:policy` ‹
`business:domain`. A domain reaches down to the shared policy vocabulary and
still cannot import a sibling domain.

## Consequences

- `requirePrincipal` moves out of `apps/marketplace-admin-service/src/auth.ts`
  into the service shell, gaining a `requirePermission` sibling and a real `403`.
- marketplace-admin-app's duplicated nav collapses into one permission-annotated
  definition that the sidebar layout derives from.
  _Revised 2026-09-02 ([ADR 0037](0037-entitlement-aware-navigation.md)): this
  line named a second consumer, `/api/menu`, which served a `workspaceMenu`
  projection of the same list. Nothing ever fetched it — the workspace reuses the
  sidebar — so it was deleted rather than kept in step._
- The admin-app middleware matcher widens from `/account/:path*` to the whole
  app, which the catalog Playwright suite must survive — hence a session-seeding
  e2e fixture lands before the matcher changes.
- Gating an app breaks Playwright's readiness probe: `/` now redirects to an
  auth-app that is not running during a `mock` run. Apps behind the gate expose
  a dependency-free `/api/health` and point `readyPath` at it.
- A guarded service e2e needs a principal for its ordinary journeys, so
  `defineServiceE2e` takes an `authorization` hook; without it every spec in the
  suite degenerates into an authentication test.
- An authorization refusal is a `ForbiddenError` → **403**, separate from
  `AuthnError` → 409. Collapsing them is how a refused promotion first came back
  as `409 identifier already in use`.
- Dev seeds are reconciled per document rather than skipped when the collection
  is non-empty. The empty-collection guard silently left a long-lived dev
  database full of users that predated the `role` aspect, so every one of them
  signed in as `user`.

### Browser → service traffic goes through a same-origin proxy

This was planned as a production-only follow-up, on the assumption that a
host-scoped cookie would be sent across `localhost` ports in dev. **That
assumption was wrong**, and live verification caught it: a different port is a
different origin, and a cross-origin `fetch` does not attach the cookie
regardless of how the cookie is scoped. Host-scoping governs which host _stores_
it, not which requests carry it. Guarding the catalog therefore broke it
immediately, in dev.

Catalog traffic now goes through `marketplace-admin-app`'s own
`/api/admin/[...path]` handler, which forwards the cookie upstream as a bearer
token — the pattern the credential routes already used, and the reason this repo
has no CORS configuration anywhere. The app's `/api/config` rewrites the service
domain to that proxy path before the browser sees it, so the adapters stay
unaware and config-service remains the single place the real address is stored.

## Follow-ups (deliberately out of scope)

- Custom/CRUD-able roles, per-record ownership rules, and tenant scoping — all
  reachable through the existing `PolicyRequest` shape without an API change.
- Zitadel OIDC and RS256/JWKS remain deferred from ADR-less v1.
