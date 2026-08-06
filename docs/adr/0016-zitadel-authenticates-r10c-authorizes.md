# 16. Zitadel authenticates; r10c authorizes and mints its own tokens

- Status: Proposed
- Date: 2026-08-05

## Trigger

The first requirement own credentials cannot meet: social sign-in, MFA, SSO for a
vendor's staff, or a compliance obligation on credential storage. Any of these
promotes this record to Accepted.

## Context

`auth-service` owns credentials today — bcrypt hashes in Mongo, recovery through
a one-time token store ([ADR 0004](0004-session-lifetime-devices-and-recovery.md)).
That was the right first step and it is not where this should end: MFA, social
providers, SSO and credential-storage compliance are all solved problems that a
marketplace has no reason to re-solve.

Zitadel has been the intended answer since the beginning. `IdentityProviderTag`
(`business-ts-authn`) is already vendor-neutral, its docblock already names
Zitadel, and `infra/local/zitadel/` already deploys one. What was never decided
is **where the seam sits** — and that decision is expensive to reverse once
credentials have migrated and tokens are being issued.

## Decision

### Zitadel authenticates. r10c authorizes, and mints its own access token.

auth-service becomes an OIDC client (authorization code + PKCE). Zitadel owns
credentials, MFA, social providers and recovery. On a successful authentication
auth-service does what it does today: opens its own Redis session and mints its
own RS256 access token ([ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)).
`IdentityProviderTag` gets a Zitadel-backed implementation; no use-case and no
route changes.

### Rejected: consuming Zitadel's tokens directly

It looks like the simpler path — one fewer signing key, JWKS for free — and it
does not survive contact with the requirements:

- `activeOrganizationId` re-mints on an organization switch, and again on an
  operator's `act-as` crossing, which must be recorded in an audit table in the
  same transaction ([ADR 0012](0012-operator-cross-tenant-access.md)). That is an
  r10c transaction; Zitadel cannot mint its result.
- Tenant roles are per-organization **data** in tenant storage
  ([ADR 0007](0007-access-model-planes-roles-entitlements.md)). Zitadel project
  grants cannot express them, and syncing would be a dual write.
- `partyRole` is resolved from a party→membership lookup in the control plane.

### Rejected: mirroring Zitadel Organizations onto r10c `Organization`

The names line up, which is exactly the trap. An r10c `Organization` is what makes
a tenant database handle derivable, and provisioning one is a multi-step operation
with migrations and seeding ([ADR 0011](0011-organization-provisioning-and-migrations.md)).
Mirroring turns that into a cross-system saga with no shared transaction, for no
capability gained. Zitadel stays a flat user store; the control plane owns
`Organization`, `Membership` and `Entitlement`.

### The canonical user id stays r10c's

`EntityIdentifier` already models an `external-subject`, which is exactly a
Zitadel `sub`. Migration maps each existing account to a Zitadel user and records
the subject as one more identifier — so every foreign key already written against
`UserIdentity.id` keeps pointing at the same record, and rollback stays possible
for as long as the local password hashes are kept.

## Consequences

- **auth-service keeps its routes and its session store.** What changes is how a
  credential is *verified*; everything downstream of "this person is who they say"
  is unchanged, which is what makes this swappable at all.
- **Two systems must be provisioned together.** Creating a user becomes a Zitadel
  write plus a control-plane write, and it needs the saga treatment rather than
  hope — the first genuinely new failure mode this introduces.
- **Local development gains a real dependency.** `infra/local/zitadel` is
  currently deployed and unused, on an unpinned `:latest` tag; it becomes
  load-bearing, needs a pinned version, a seeded realm, and a readiness probe like
  every other datastore in the ladder.
- **Own credentials do not disappear on day one.** The two coexist while accounts
  migrate, which is the one place a compatibility window is justified — and it is
  bounded by the migration, not open-ended.
