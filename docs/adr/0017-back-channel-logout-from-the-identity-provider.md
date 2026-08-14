# 17. Back-channel logout: the provider can end an r10c session

- Status: Accepted
- Date: 2026-08-07
- Revised: 2026-08-14 — the append-only `oidc:sid:` set is recorded as a
  deliberate invariant with the constraint that keeps it true, rather than as a
  question deferred to an issue. The decision is unchanged.

## Context

[ADR 0016](0016-zitadel-authenticates-r10c-authorizes.md) made sign-out two
steps in one direction: `POST /api/auth/logout` revokes the Redis session and
returns an RP-initiated `endSessionUrl` the browser navigates to, so the
provider's session ends with ours.

The reverse did not happen. A session ended **at Zitadel** — someone signs out
in the console, an operator terminates their sessions — left r10c's session
alive until its own absolute ceiling, seven days, minting a fresh access token
on every `refresh` in between. Nothing in the fleet would notice: `refresh` is
store-only by design, and the store said the session was fine.

That is not an edge case. "Sign me out everywhere" is precisely the control a
person reaches for when they believe an account is compromised, and the identity
provider is the natural place to reach for it. Doing it there signed them out of
nothing.

The provider side was already available (`enableBackChannelLogout` is on at the
instance by default) and nothing was half-built: no `logout_token` handler
existed anywhere, and the OIDC app `r10c-web` had `backChannelLogoutUri: null`.

The real design gap was the mapping. Our session id is our own. The `id_token`
store keys `sessionId → id_token` and nothing indexed the provider's `sid` back
to us — in fact `sid` was never read at all: `ZitadelIdentity` had no field for
it, so the claim was discarded at the client boundary and a logout token would
have named a session id that meant nothing here.

## Decision

`POST /api/auth/backchannel-logout` on auth-service, registered as the OIDC
app's `backChannelLogoutUri` by `tools/zitadel-seed.mjs`.

### The `sid` is recorded at sign-in, in its own index

`ZitadelIdentity` gains `providerSessionId`, read from the **verified id_token**
and explicitly not from userinfo — `sid` decides whose sessions a later logout
token revokes, so it may only come from the document whose signature was
checked. The OIDC callback links it in `ProviderSessionIndex`, a Redis **set**
at `oidc:sid:{sid}` expiring at the session's absolute ceiling.

A set, not a single id, because one Zitadel session can open several r10c
sessions — the same browser reaching two apps, or signing in again without the
provider prompting. Ending it at the provider must end all of them.

Kept separate from the `id_token` store, close as the two look: that one holds a
bearer credential with a single reader and read-and-forget semantics; this one
holds our own ids and its reader is a request arriving from outside.

### Verification is the authentication, and the `nonce` check is the boundary

The route is unauthenticated because it must be: the caller is a server, not a
browser, and holds no cookie. The logout token's signature is what authenticates
it. `verifyLogoutToken` reuses the same key set, issuer and audience as
`verifyIdToken` — both now go through one `verifyProviderJwt` so the pinned
`algorithms: ['RS256']` exists in exactly one place and a second verifier cannot
be added without it — and then applies OIDC Back-Channel Logout 1.0 §2.6:

- `events` must carry `http://schemas.openid.net/event/backchannel-logout`;
- at least one of `sub` / `sid`;
- **`nonce` must be absent.**

That last check is the load-bearing one and is why the two verifiers stay
separate functions. Without it a stolen `id_token` POSTed to this endpoint would
verify perfectly — right key, right issuer, right audience — and sign its owner
out.

### `sid`-precise, with `sub` as the fallback

A token naming a `sid` revokes exactly the sessions in that set, and drops each
one's stashed `id_token` with it. A token naming only `sub`, **or a `sid` that
resolves to nothing**, resolves the account through the existing
`findByIdentifier` and calls `revokeAllForUser`.

Folding those two cases together is deliberate: an empty set is also exactly what
a lost index write looks like from here, and the link is best-effort so a sign-in
never fails on it. The fallback is what keeps that failure from becoming a
session that quietly survives.

### Three shapes of answer

A token that does not verify is `400`, so a misconfigured provider is loud at
Zitadel rather than silent. A token that verifies but names nothing we know is
`200` — a `404` would make the endpoint an oracle for whether a session exists,
and the provider has nothing useful to do with the answer either way. The
response carries `Cache-Control: no-store`.

No `jti` replay store. Every effect here is a revoke, `take` empties the index,
and revoking a revoked session is a no-op, so a replayed token costs one Redis
round trip and nothing else. That stops being true the moment this route does
something non-idempotent, and the docblock says so.

### The seed guard became a revision key

Registering the URI exposed a second bug. `ensureApp` was create-only — it
returned early on an existing app and the file had no `PUT` at all — and the
ladder's L6 guard was `[[ -s .generated.env ]]`, a "has this ever run" flag. The
`ensure.sh` fast path exits before `seed_zitadel` is even called, so a seed that
gained a setting would have reached only machines that happened to reset, while
every other one reported green.

So: `ensureApp` reconciles through `PUT …/oidc_config` with the same body the
create path uses (Zitadel's update is a full replace; two copies would drift),
and `ZITADEL_SEED_REVISION` is stamped into `.generated.env` and checked by
`zitadel_seeded`. Still a file read, so the fast path costs nothing — but it is a
cache key now, and a seed change reaches everyone on their next boot without a
reset.

Note the host in the registered URI:
`http://host.minikube.internal:3102/api/auth/backchannel-logout`. Unlike the
redirect URIs this one is not browser-facing — Zitadel calls it server-to-server
from inside minikube, where `localhost` is the pod itself.

### Rejected: always revoke every session for the `sub`

Simpler — no index, no change to `ZitadelIdentity`, no change to the callback —
and wrong in the ordinary case. Signing out of one browser at the provider would
end that person's sessions everywhere else too. The `sub` path survives as the
fallback, where being coarse is better than doing nothing.

### Rejected: re-check `UserStatus` on `refresh`

Tempting as a general safety net, and it does not solve the problem people
reach for it to solve: deactivating a user **in Zitadel** never writes r10c's
`UserIdentity.status`, so this closes nothing on the provider side. What it would
close is r10c-side status drift, and there is no such drift — `updateUserRoute`
already revokes every session on a status or role change. So it buys a Mongo read
on every refresh for a hole that is already shut.

### Rejected: poll the provider's user state on `refresh`

This would close deactivation properly, and it couples session renewal to
provider availability: a Zitadel outage would stop everyone refreshing, turning a
sign-in outage into a whole-fleet one. It also puts a network hop on a path that
runs every twelve minutes per active user.

### Rejected: front-channel (iframe) logout

Complementary rather than alternative, and the weaker half — it only works while
a browser tab is open, which is not the case a compromised-account sign-out
needs. Tracked as issue #53.

## Consequences

- **Sign-out is bidirectional.** Ending a session at Zitadel ends the r10c
  sessions it opened, and the next `refresh` 401s. `requirePrincipal` stays
  stateless, so revocation is still bounded by the 15-minute access-token TTL on
  the hot path — the same bound ADR 0007 already documents for role changes.
- **`refresh` is unchanged.** Still `touch` → `read` → `sign`, no Mongo, no
  network. The property [ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md)
  and [ADR 0002](0002-authorization-roles-and-abac.md) protect is untouched.
- **A third Redis namespace joins `session:` and `oidc:id-token:`, and it is
  append-only until `take`.** Ids of sessions r10c revoked itself are left in the
  set on purpose: revoking a revoked session is a no-op and the key expires at
  the ceiling, so the set cannot grow without bound. It is also the only option
  on the table — there is no `sessionId → sid` mapping in the system, `SREM`
  needs the key, and `revokeAllForUser`/`revokeAllForUserExcept` return `void`,
  so most revocation sites never learn the ids they killed. Unlinking is a second
  namespace written at the callback, not a call added at four sites. **The
  invariant this rests on: anything added to the back-channel route must stay
  idempotent.** It is the same argument as the deliberately absent `jti` replay
  store, and the two stand or fall together.
- **A seed change now reaches an already-seeded instance.** Bump
  `ZITADEL_SEED_REVISION` in `infra/local/lib.sh` in the same commit as any
  change to `tools/zitadel-seed.mjs` that adds or alters a setting, or it will
  silently reach only fresh machines.
- **Deactivation at the provider is a separate question, verified rather than
  designed around.** See below.
- **This extends ADR 0016 and supersedes nothing.**

## The deactivation finding

Zitadel does not fire a back-channel logout for every way a session can stop
being usable, and deactivating a user is the case that matters. Rather than
price a `refresh`-time check for a hole whose shape was assumed, the live pass
deactivates a user and observes what actually arrives.

**Result, measured against Zitadel v4.16.2 on 2026-08-07.** A provider sign-out
does fire: an RP-initiated `end_session` produced a logout token on the endpoint
and the r10c session was gone inside a second. Deactivating the same user
through `POST /management/v1/users/{id}/_deactivate` produced **nothing** — no
logout token arrived, and the r10c session was still refreshing `200` twenty
seconds later.

So the gap is real and stays open, deliberately. Both ways of closing it are
rejected above, and neither becomes a better idea for having measured this: a
`UserStatus` re-check still would not see a change Zitadel never wrote here, and
polling the provider still trades a fleet-wide dependency for it. It is tracked
as issue #52 rather than closed with the wrong mechanism.

What does close it today is the path that already exists: deactivating a user in
r10c (`PATCH /api/user-identity/:id`) revokes every session immediately. The
hole is specific to deactivating at the provider and not here.
