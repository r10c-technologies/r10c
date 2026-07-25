# 2. Authorization: role aspects behind an ABAC-shaped port

- Status: Accepted
- Date: 2026-07-24

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

### Three enforcement layers, one of which is security

1. **Next middleware** — cookie presence, a fast bounce. Not a check.
2. **Server-rendered layout / menu** — filters nav items with `can(...)` and
   gates the auth-app back-office. This is UX, and it is where the role gate
   lives rather than in middleware, because verifying the JWT at the edge would
   mean copying `jwt.secret` out of config-service into the Next runtime.
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
  definition that both the sidebar layout and `/api/menu` derive from.
- The admin-app middleware matcher widens from `/account/:path*` to the whole
  app, which the catalog Playwright suite must survive — hence a session-seeding
  e2e fixture lands before the matcher changes.

## Follow-ups (deliberately out of scope)

- **Browser → service auth in production.** Catalog client pages call
  `http://localhost:3101/api` directly from the browser. In dev the `r10c_at`
  cookie is host-scoped on `localhost`, so it is sent across ports and the guard
  works. Different hosts in production will need a same-origin Next proxy or
  CORS with credentials.
- Custom/CRUD-able roles, per-record ownership rules, and tenant scoping — all
  reachable through the existing `PolicyRequest` shape without an API change.
- Zitadel OIDC and RS256/JWKS remain deferred from ADR-less v1.
