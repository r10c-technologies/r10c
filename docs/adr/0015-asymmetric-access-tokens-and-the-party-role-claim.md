# 15. Asymmetric access tokens, and the party role as a claim

- Status: Accepted
- Date: 2026-08-05

## Context

Two things changed at once, and they turn out to have the same root.

**The storefront is public.** `marketplace-app` serves anonymous traffic, mostly
prerendered. When buyers can sign in, it becomes a token consumer — and under
HS256 ([ADR 0002](0002-authorization-roles-and-abac.md), which deferred RS256)
consuming a token means holding the key that *signs* them. The least privileged,
highest traffic app in the fleet would hold material that mints `super-admin`.

**Absence was carrying meaning.** `activeOrganizationId` is unset for a buyer and
unset for an operator. That comment appears verbatim in five files, and
[ADR 0007](0007-access-model-planes-roles-entitlements.md) already named the
problem: _"a single `roles` string array cannot say which side a principal is
on."_ The reach of those two populations could hardly differ more, and nothing in
a token distinguished them.

Both are the same mistake: a security-relevant fact represented by something
weaker than the fact itself — a symmetric key standing in for "may verify", an
omission standing in for "which population".

## Decision

### Access tokens are RS256, signed with a `kid`

`jose-token-service.ts` takes `publicKeyPem` (always) and `privateKeyPem` (only
the minting service). auth-service is the fleet's only holder of a private key.
`verifyAccessToken` pins `algorithms: ['RS256']` — **that line is the file's
security boundary**: left unset, jose honours the algorithm in the token's own
header, so a caller could present an HS256 token and have the public key treated
as a shared secret. There is a spec for exactly that forgery.

**Hard cut, no dual-verify window.** Nothing runs in production, so no issued
token must survive. A verifier that branches on `alg` is the alg-confusion
surface itself, and the cheapest way not to get it wrong is not to have it.

### Every service resolves the public key from config-service at boot

`jwt.publicKey` + `jwt.keyId` are ordinary configuration parameters, resolved the
same way `mongo.uri` is. Verification is local, on the hot path, with no fetch
and no dependency on auth-service being reachable — which preserves the property
[ADR 0002](0002-authorization-roles-and-abac.md) established, that authorizing a
request costs no round trip.

auth-service *also* serves `GET /.well-known/jwks.json`, unauthenticated. No
fleet service reads it; it exists for consumers that hold no fleet configuration —
a browser or edge runtime, which is what buyer sessions on the storefront need —
and because it is the shape every OIDC client already speaks. Rotation is a
config write plus a restart, expressible because tokens name their key.

### The party role is a claim

The token carries `partyRole` — `customer` / `vendor` / `operator`, the closed
set already in `party-management/values/party-role.ts`, which also maps to the
storage plane through `PLANE_FOR_PARTY_ROLE`. It is resolved once at sign-in by
the party lookup that already ran (renamed `SessionScopeResolver`, since it now
answers the whole question), stored on the session, and re-signed unchanged on
refresh — re-resolving there would let a membership edit silently move a live
session to another plane.

It lives on `Individual`, not on `UserIdentity`: persona is a fact about the
person, `role` is the authorization aspect, and collapsing the two axes is what
ADR 0007 forbids. An account with no party record resolves to `customer` — a
self-registered buyer, and the safest thing to be wrong about.

This ADR names the axis `partyRole` with the values `party-management` already
uses, rather than ADR 0007's `buyer` / `vendor-member` / `operator`. Same axis,
one vocabulary instead of two.

### Secrets are flagged, and redaction reads the flag

Found while moving key material: every service's **unauthenticated**
`GET /api/config` returned `redactConfiguration(plain)`, which masked only the
`user:pass@` segment of a connection URI. `jwt.secret` is not a URI, so it was
served in full — an authentication bypass, and the RSA private key would have
gone the same way.

`ConfigurationItem` now carries `isSecret`, propagated from the `is_secret`
column config-service already maintains, and `redactConfiguration` blanks
anything flagged. Keyed off the store's own flag rather than a guess about the
key's name, because a naming heuristic that misses once publishes a signing key.

## Consequences

- **`jwt.secret` is gone** from the seed and from every composition root. A
  machine with an existing local database keeps the dead row until the next
  `dev:reset`; nothing reads it.
- **Only auth-service can mint.** A verify-only token service fails `sign` with a
  build error rather than producing an unsigned token. `marketplace-admin-service`
  and `config-service` are now structurally incapable of forging a principal.
- **`partyRole` is carried, not yet consumed.** Nothing branches on it in this
  change — no guard, no resolver, no nav filter. It is the prerequisite the
  operator `act-as` crossing ([ADR 0012](0012-operator-cross-tenant-access.md))
  and buyer accounts both need, and shipping it inert keeps the change reviewable.
- **A session predating this claim has no `partyRole`.** It reads as `undefined`,
  never as a default, so a future consumer must decide explicitly rather than
  inheriting a silent `customer`.
- **Supersedes ADR 0002 on RS256 only.** Its role/permission model, its
  `PolicyDecision` port and its "grants are derived at the consumer, never in the
  token" invariant all stand — `partyRole` is routing context, not a grant.
- **The e2e suites hold their own key pair** (`entifix-ts-testing-e2e/fixtures`),
  deliberately not the development pair, so a suite cannot pass by verifying a
  real token.
