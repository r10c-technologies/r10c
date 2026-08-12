# 19. A user deactivated at the provider loses their r10c sessions

- Status: Accepted
- Date: 2026-08-11

## Context

[ADR 0017](0017-back-channel-logout-from-the-identity-provider.md) made sign-out
bidirectional: ending a **session** at Zitadel revokes the r10c sessions it
opened. Its live pass then measured the case it could not cover, and recorded it
rather than designing around it — deactivating a **user** fires nothing at all.

Measured against Zitadel v4.16.2 on 2026-08-07:

| action at the provider                       | logout token | r10c session           |
| -------------------------------------------- | ------------ | ---------------------- |
| RP-initiated `end_session`                   | fires        | gone in ~1s            |
| `POST /management/v1/users/{id}/_deactivate` | **none**     | still refreshing `200` |

So an account that no longer exists as far as the identity provider is concerned
kept a live r10c session, and kept being handed a fresh access token on every
`refresh`, until the session hit its seven-day absolute ceiling. Deactivating an
account is the strongest lever an operator has, and it moved nothing here.

ADR 0017 rejected the two obvious fixes, and measuring the hole did not improve
either one: a `UserStatus` re-check on `refresh` cannot see a change Zitadel
never wrote into r10c, and polling the provider on `refresh` couples session
renewal to Zitadel's availability while putting a network hop on a path that runs
every twelve minutes per active user. Tracked as issue #52.

What was left unexplored was the provider's own event machinery, which is where
this ADR goes.

## Decision

A **Zitadel Actions v2 event execution** POSTs to
`POST /api/auth/provider-events` on auth-service, which revokes every r10c
session belonging to the named subject. Event-driven: nothing is added to
`refresh`, nothing polls, and Zitadel's availability stays out of the session
renewal path.

### Three events, one target, one handler

`user.deactivated`, `user.locked` and `user.removed`. All three are `user`
aggregate events, so the payload's `aggregateID` is the provider's user id in
every case — the same value that arrives as `sub` in an `id_token` and is stored
as the account's `external-subject` identifier. The route therefore resolves the
subject through the existing `findByIdentifier` and calls `revokeAllForUser`,
which is exactly the `sub` fallback the back-channel route already uses.

Locking and deleting were included because they are the same hole with a
different verb, and excluding them would mean shipping a fix that leaves two of
its three cases open.

### The HMAC is the authentication

The route is unauthenticated for the same reason the back-channel one is: the
caller is a server holding no cookie. Zitadel signs an Actions v2 payload with a
per-target key and sends `ZITADEL-Signature: t=<unix>,v1=<hex>`, the hex being
`HMAC-SHA256(key, "<t>.<raw body>")`, valid for 300 seconds. `verifyEvent`
checks it with a constant-time compare before the body is looked at.

Three details that are load-bearing rather than incidental:

- **The body is read raw** (`req.text`, not `req.json`). The MAC covers the bytes
  Zitadel sent; a parsed-and-reserialised object is a different byte sequence.
- **An empty key fails closed.** A fleet whose signing key never arrived — the
  seed did not run, the config row is blank — must reject every call. The one
  outcome worse than the bug this closes is an open endpoint that revokes
  anyone's sessions on request.
- **The timestamp is inside the MAC**, which is what bounds replay. No `jti`
  store, on ADR 0017's argument: every effect is a revoke and revoking a revoked
  session is a no-op.

This lives in its own module, deliberately not folded into the OIDC client: that
one verifies asymmetric provider JWTs behind a pinned `algorithms: ['RS256']`,
and the whole point of that pin is that no symmetric key is ever accepted there.

### Three shapes of answer, as next door

A payload that does not verify is `400`, so a key mismatch is loud at Zitadel. A
verified event naming a subject we do not know is `200` — a `404` would make the
endpoint an oracle for whether an account exists here. A verified event we do not
act on is also `200`, so an execution can be added at the provider without a
deploy here. `Cache-Control: no-store` throughout.

### The signing key is carried forward across re-seeds

Zitadel mints the key inside `CreateTarget` and never serves it again: there is
no read-back and no rotate-in-place. Meanwhile config-service's seed is
`INSERT … ON CONFLICT DO NOTHING`, so a key that changed would never reach the
Postgres row auth-service reads, and the webhook would reject every call in
silence — the bug would look unfixed and the cause would be invisible.

So `ensureActionTarget` reads the previous `.generated.env` before rewriting it
and keeps the existing key whenever the target still exists, reconciling only the
endpoint. A new key is minted only when there is no target to pair with it; a
target found with no key on disk is deleted and recreated, loudly, because that
pair can no longer be repaired. `dev:reset` recreating both halves together is
what makes the pairing safe, exactly as it already does for the OIDC client id.

### Rejected: writing `UserIdentity.status` from the event

It reads like the tidy thing to do and it would lock people out permanently.
Nothing projects status back from Zitadel — `resolveSignIn` refuses a non-`Active`
user _before_ `projectIdentity` runs, and that projection never touches status —
so a local `disabled` written here would survive a Zitadel *re*activation with
nothing able to undo it. Revoking is also sufficient on its own: Zitadel will not
authenticate a deactivated user, so no new session can open behind the
revocation. `status` stays r10c's own field with one writer.

### Rejected: an events-API reconciler instead of a webhook

`POST /admin/v1/events/_search` can be polled for the same event types on a
cursor, which survives auth-service being down. It is also a second scheduled
process, a cursor to store and reason about, and a thing only a live pass can
exercise. The webhook is what closes the measured hole; the reconciler is the
durability upgrade on top of it, and is worth building when the gap below is felt
rather than pre-emptively.

### Rejected: confirming the event against the provider before revoking

Re-reading `GET /v2/users/{id}` with the PAT would make forgery useless without a
shared secret. But an unauthenticated endpoint that makes an outbound call per
POST is an amplifier, and it re-adds the provider round trip this design exists
to avoid. Once the signature holds, the confirmation buys nothing.

## Consequences

- **Deactivating, locking or deleting a user at the provider ends their r10c
  sessions in about a second.** The `refresh` path is unchanged — still `touch`
  → `read` → `sign`, no Mongo, no network — so the property ADRs 0015 and 0002
  protect is untouched, and revocation is still bounded on the hot path by the
  15-minute access-token TTL.
- **An event fired while auth-service is down is lost.** Event executions are
  fire-and-forget (`restAsync`) and Zitadel does not retry them, so the session
  survives to its seven-day ceiling exactly as before. That is the residual gap,
  it is bounded, and closing it is the reconciler above.
- **auth-service now holds a symmetric secret.** `zitadel.actionSigningKey`, seeded
  `is_secret: true` so the unauthenticated `/api/config` blanks it. A row that
  forgot the flag would publish it, and publishing it is equivalent to leaving the
  endpoint open.
- **`ZITADEL_SEED_REVISION` is 4.** The bump rule from ADR 0017 applies unchanged:
  the fast path exits before L7, so a seed change without a bump reaches only
  machines that happened to reset.
- **The DenyList already covers this.** `HTTPClient.DenyList` in
  `infra/local/zitadel/config.yaml` governs Actions v2 targets and back-channel
  logout alike, and its `192.168.0.0/16` carve-out is what lets a target point at
  `host.minikube.internal:3102`. A future local integration that Zitadel must call
  back into needs no further change.
- **This extends ADR 0017 and supersedes nothing.** Issue #52 is closed by it;
  issues #53 (front-channel logout) and #54 (the `jti`/index revisit) are not.

## The live pass

Measured against Zitadel v4.16.2 on 2026-08-11, on the same fleet that produced
the finding in ADR 0017.

- **The signature header is `ZITADEL-Signature`.** The `CreateTarget` proto
  comment says `X-ZITADEL-Signature`; the sender
  (`internal/execution/execution.go` setting `actions.SigningHeader`) says
  otherwise, and the sender is right — a target verifying the documented spelling
  would reject every call. Pinned to what is sent, not to what is documented.
- **Deactivation now propagates in about a second.** Signed in as `ada` through
  the hosted login, confirmed `refresh` answered `200`, ran
  `POST /management/v1/users/{id}/_deactivate`, and `refresh` answered `401`
  three seconds later. Locking a second user produced the same webhook call, so
  the three executions are wired and not just registered.
- **The endpoint rejects what it should.** An unsigned POST and one carrying a
  garbage signature both answer `400` and leave the session refreshing `200`.
- **Actions v2 needs no feature flag on v4.16.2.** `actions` is `reserved` in
  `feature/v2/instance.proto` — the flag existed while the API was beta and the
  API is now GA at `/v2/actions/*`.
- **Re-running the seed is a no-op.** The second run reported the target already
  present and left `ZITADEL_ACTION_SIGNING_KEY` byte-identical, which is the
  carry-forward rule above doing its job.
