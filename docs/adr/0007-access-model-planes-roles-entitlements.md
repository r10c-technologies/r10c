# 7. Access model: planes, platform roles, tenant-defined roles, entitlements

- Status: Accepted
- Date: 2026-08-01
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  the entitlement vocabulary is the set of **tenant-facing** domains;
  `catalog-reference` is operator-owned and never grantable.
- Amended by: [ADR 0037](0037-entitlement-aware-navigation.md) — the entitlement
  is read for the first time. It rides the access token and filters navigation;
  the `PermissionResolver` follow-up below is still unbuilt.

## Context

[ADR 0002](0002-authorization-roles-and-abac.md) shipped RBAC behind an
ABAC-shaped port: `Roles = ['user', 'admin', 'super-admin']` — a deliberately
**closed, ordered** set, because an ordered tier is what makes the escalation
rule ("assign at or below your own tier") expressible without a policy language.
Grants come from a static `ROLE_PERMISSIONS` table derived at each consumer, so
the token carries only role names and a policy edit takes effect on deploy rather
than waiting out every issued token.

Three requirements break that model:

1. **A vendor defines its own roles** — "sales", "inventory", whatever its
   business needs. A closed set in code cannot express a role invented by a
   customer last week.
2. **An operator needs technical depth** — deeper diagnostics than an ordinary
   admin. Today that is modelled as maximum seniority: `super-admin: ['*:*:*']`,
   commented _"the developer tier: everything"_.
3. **Vendors and operators are different populations** on opposite sides of the
   tenancy boundary ([ADR 0006](0006-multitenancy-planes-and-tenant-storage.md)),
   and a single `roles` string array cannot say which side a principal is on.

## Decision

### Three axes, previously collapsed into one

| Axis                                               | Decides                              | Shape                      | Lives in                                |
| -------------------------------------------------- | ------------------------------------ | -------------------------- | --------------------------------------- |
| **Plane** — `buyer` / `vendor-member` / `operator` | which data plane the principal is on | closed set, in the token   | code                                    |
| **Platform role**                                  | operator seniority and capability    | closed, ordered            | code (`ROLE_PERMISSIONS`)               |
| **Tenant role**                                    | what a vendor's staff may do         | **open, per-organization** | **data**, in the organization's storage |

Plane is not a role — it is the routing key the tenant resolver reads. Collapsing
it into `roles` is what would let a string comparison decide a storage boundary.

### Rank and grants split

`ROLE_RANK` keeps its single job: the assignment ceiling (`canAssignRole` — you
may mint at or below your own tier). Grants stop moving with it.

"Developer detail" becomes an explicit permission set —
`platform:diagnostics:read`, `platform:trace:read`, and the config CRUD that
already exists — not the top of a seniority ladder. A support engineer can then
read diagnostics without being able to mint operators, which `*:*:*` made
impossible to express.

### Tenant roles are data; grants are still never in the token

A tenant role is a record in the organization's storage: a name and a permission
list. The token continues to carry only role **names** plus the organization
([ADR 0006](0006-multitenancy-planes-and-tenant-storage.md)); a
`PermissionResolver` behind the existing `PolicyDecisionTag` resolves names to
grants, TTL-cached per organization.

This preserves ADR 0002's invariant — grants are derived at the consumer, never
embedded in an issued token — at the cost of a cached lookup. The alternative,
putting resolved permissions in the token, makes grants frozen until refresh and
grows the token with the permission set.

### Entitlements are the second assignment ceiling

An `Organization`'s `Entitlement` is the list of business domains it is
provisioned for. A tenant role may only grant permissions inside them: an
organization not provisioned for stock cannot mint a role granting
`stock-management:*:write`, however senior the person minting it.

So there are two independent ceilings — the actor's own tier, and the
organization's provisioning — and the second one is also the SaaS provisioning
record. Since a permission's domain segment _is_ the package's domain name
([ADR 0005](0005-business-domain-decomposition.md)), the entitlement list needs no
separate module registry.

**Not every domain is grantable.** `catalog-reference` — the platform-owned
brand, category and dictionary vocabulary — is operator-authored and can never
appear in an `Entitlement`
([ADR 0022](0022-v1-marketplace-module-boundaries.md)). An organization is not
"provisioned for" the platform's shared classification, and a tenant role mintable
against it would let one vendor rewrite the browse tree every other vendor is
classified into — precisely the escalation this ceiling exists to stop.

So the entitlement vocabulary is the set of **tenant-facing** domains, not the set
of all domains. That is a narrowing of this record's original claim, and it is
the first domain to sit outside it.

## Consequences

- **Nav filtering must move from role names to resolved permissions.**
  `unverifiedClaims` reads the cookie without checking its signature to filter
  navigation. Static nav configuration cannot know a role a vendor invented last
  week, so the filter has to key off resolved permissions. It stays presentation
  only and never a decision — hiding a nav item still protects nothing.
  _Revised 2026-09-02 ([ADR 0037](0037-entitlement-aware-navigation.md)): half of
  this is now built and half is not, and the halves are independent. The
  **entitlement** ceiling is live — it rides the token as a claim resolved at
  sign-in, and an item opts into it with `entitled: true`. The move off **role
  names** is not, because it waits on the `PermissionResolver` below: until a
  tenant-defined role can be resolved to grants, `can(roles, permission)` against
  the static table is all there is to filter with._
- **Role revocation is eventually consistent, bounded by the access-token TTL.**
  The token carries role names, so removing someone from a role goes stale until
  the token refreshes. For urgent revocation the existing session-revoke path is
  the answer, and it is immediate. Documented rather than fixed: making
  `requirePrincipal` read the session per request would trade a stateless hot
  path for a Redis round trip on every call.
- **A tenant role table is per-organization data, so a policy edit is a customer
  action.** It is audited and rate-limited like any other tenant write, not
  reviewed like a deploy.
- **The static `ROLE_PERMISSIONS` table survives** for platform roles. Two grant
  mechanisms coexist by design: code for the population we employ, data for the
  population we serve.
- **`business-ts-authz` stays `business:policy`** — vocabulary and ports only.
  The role _records_ live in `business-ts-access-management` (`business:domain`),
  because entities and repositories must not appear in the shared policy
  vocabulary every domain depends on.

## Follow-ups (deliberately out of scope)

- The `PermissionResolver` adapter and its cache invalidation. Until it lands,
  roles are seeded and resolution stays static.
- Per-record ownership rules (a vendor's staff seeing only their own drafts) —
  reachable through the existing `PolicyRequest` shape.
- Delegated administration inside an organization beyond the two ceilings.
