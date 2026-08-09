# 16. Zitadel authenticates; r10c authorizes and mints its own tokens

- Status: Accepted
- Date: 2026-08-05
- Accepted: 2026-08-06

## Trigger

The first requirement own credentials cannot meet: social sign-in, MFA, SSO for a
vendor's staff, or a compliance obligation on credential storage.

**This fired on 2026-08-06** — MFA and social sign-in were both asked for, which
is two of the four. The record is Accepted and built; the amendments the build
made to it are marked below.

## Context

`auth-service` owned credentials — bcrypt hashes in Mongo, a Redis lockout
ledger, recovery through a one-time token store
([ADR 0004](0004-session-lifetime-devices-and-recovery.md)). That was the right
first step and it is not where this should end: MFA, social providers, SSO and
credential-storage compliance are all solved problems that a marketplace has no
reason to re-solve.

Zitadel has been the intended answer since the beginning. `IdentityProviderTag`
(`business-ts-authn`) is already vendor-neutral, its docblock already names
Zitadel, and `infra/local/zitadel/` already deployed one. What was never decided
is **where the seam sits** — and that decision is expensive to reverse once
credentials have migrated and tokens are being issued.

## Decision

### Zitadel authenticates. r10c authorizes, and mints its own access token.

auth-service is an OIDC client (authorization code + PKCE, public client, no
secret). Zitadel owns credentials, MFA, social providers and recovery. On a
successful authentication auth-service does what it always did: opens its own
Redis session and mints its own RS256 access token
([ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)).
`establishSession` is untouched by the swap, which is what makes this a change to
_how a credential is verified_ rather than a rewrite of the auth layer.

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
Zitadel `sub`. A sign-in resolves that subject to a `UserIdentity`, so every
foreign key already written against `UserIdentity.id` keeps pointing at the same
record and the provider can be rebuilt — or replaced — by rewriting rows in one
collection.

### One writer per field

**Amendment, decided while building.** Two records exist for one person, and the
fix for drift is not "one copy" but one writer. The overlap is exactly four
members:

| Field                                                                           | Writer                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------- |
| password, MFA enrolment, social links                                           | Zitadel — no local copy exists                      |
| `role`, `Individual.partyRole`, `Membership`, devices, sessions                 | r10c — Zitadel never sees them                      |
| email/username `EntityIdentifier.value`, `UserIdentity.displayName`, `verified` | **Zitadel**; the local row is a projection          |
| `UserIdentity.status`                                                           | r10c — it decides whether a session may open at all |

A projected member follows the rule CLAUDE.md already states for audit stamps: it
stays a writable accessor (`@accessor({ readonly })` would drop it from
_deserialization_ too, and the UI would never see it) and the **route** overwrites
it from the verified source — the `id_token`, on every callback. The only stale
case left is a user who changes their email in Zitadel and never signs in again,
costing one misaddressed device alert.

### Provisioning is local-first with repair on retry, not a saga

**Amendment.** Creating a user writes to two systems, which looks like the saga's
job ([ADR 0008](0008-domain-modules-and-service-topology.md)) and is not the
right first consumer for it:

- `acceptTransaction` is synchronous and everything after it is forked past the
  `202`. Back-office user creation is an interactive form, and the OIDC callback's
  auto-provisioning **must** return a session synchronously — so the engine could
  only ever cover the rarer of the two paths.
- There is nothing meaningful to lock. Uniqueness is enforced by Zitadel and by
  the identifier index.

Instead: write `UserIdentity` first (it owns the role and the party), then the
Zitadel human, then record the `external-subject` and project the attributes back.
A failed provider write leaves a local record with **no subject** — it cannot sign
in, it is visible in the users list, and submitting the same form again repairs
it. One legible half-state beats a compensation that can itself fail. The engine's
designed-for cross-plane consumers remain
[ADR 0009](0009-catalog-authoring-and-publication.md) and
[ADR 0010](0010-stock-ledger-reservations-and-concurrency.md).

## Consequences

- **auth-service keeps its session store, its token, its roles and its tenancy.**
  `register` and `login` are gone; `POST /api/auth/oidc/start` and
  `POST /api/auth/oidc/callback` replace them, and everything downstream of "this
  person is who they say" is unchanged.
- **r10c holds no credential at all.** bcrypt, the `user-credential` collection,
  the `PasswordHasher` port, the lockout ledger and `LockedError` are deleted, and
  `AccountRepository` has no method that could read or write a secret. That
  absence is the property the whole record exists to buy: a dump of the auth
  database yields nothing anyone can sign in with.
- **Rate limiting moved with the credential.** Our lockout ledger counted failed
  password attempts; there are none to count here, and Zitadel enforces its own.
- **Own credentials do not coexist.** **Amendment**: the original consequence said
  the two would run side by side while accounts migrated. Nothing runs in
  production, so `dev:reset` _is_ the migration and a compatibility window would
  only be dead code with a security surface — a verifier that still accepts a
  password is a verifier that can be made to.
- **Local development gained two real dependencies.** `infra/local/zitadel` is
  load-bearing, pinned, probed, and seeded by a rung of the health ladder;
  Mailpit joins as the SMTP target so verification and recovery mail stays
  readable end to end. **Amendment**: the hosted login later became a third
  workload of its own — the seed's pin to Zitadel's v1 login is reversed by
  [ADR 0018](0018-the-hosted-login-is-a-second-container.md), which also moves
  the seed to L7 to make room for it.
- **Sign-out is two steps now.** Revoking our session without ending the
  provider's leaves someone "signed out" who is one click from being signed
  straight back in with no prompt. The logout route returns an RP-initiated
  `endSessionUrl`, and every sign-out control navigates to it. That covers
  r10c → Zitadel only; the reverse direction is
  [ADR 0017](0017-back-channel-logout-from-the-identity-provider.md).
- **This supersedes ADR 0004's recovery and lockout sections.** Session lifetime,
  the sliding window and device history all stand unchanged.
  [ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md) stands in
  full — we still mint our own RS256 token.
