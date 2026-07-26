# 4. Session lifetime, device identity, and account recovery

- Status: Accepted
- Date: 2026-07-26

## Context

The v1 auth layer ([ADR 0002](0002-authorization-roles-and-abac.md) covers the
authorization half) shipped deliberately narrow: opaque Redis sessions plus a
short-lived HS256 token in an httpOnly cookie. Password reset, rate limiting and
session visibility were all listed as deferred.

Two things forced the issue.

**The refresh half was dead code.** `setSessionCookies` sized the `r10c_at`
cookie to the *access token's* 15 minutes. When that cookie expired, the
middleware's presence check could not tell "this token needs refreshing" from
"there is no session", and chose the second — so every user was bounced to
sign-in four times an hour while their Redis session had days left.
`POST /api/auth/refresh` existed on auth-service and **no app had ever called
it**: there was no refresh route handler anywhere under `apps/*/src/app/api`.

**Recovery did not exist.** A user who forgot their password had no path back
into their account, and there was no limit on how many passwords an attacker
could try.

## Decision

### Sliding sessions under a hard ceiling, tuned from one file

Idle **1 day**, absolute **7 days**, access token **15 min**. The window slides
on refresh; the ceiling is stamped at login and never moves, so
`SessionStore.touch` clamps every renewal to `min(now + idle, absoluteExpiresAt)`
and fails past it. A sliding window with no ceiling renews forever, which means a
compromised session that keeps being used never ends.

All five numbers live in `business-ts-authn/values/session-policy.ts`
(`scope:shared`, framework-free), because both ends need them: the service mints
sessions with them and every Next app schedules its refresh against them. Two
copies of "fifteen minutes" is how a signer and a verifier silently disagree.

### Activity means a person, not an open tab

`requirePrincipal` verifies statelessly and never reads the session store — a
deliberate v1 property. Sliding the session on every guarded request would put
Redis back on the hot path and undo it.

So **refresh slides the session, and the client only refreshes while the user is
present**: `useSessionRefresh` fires at 80% of the token's life but skips the
call after 15 minutes without pointer/key/visibility activity. An abandoned tab
stops refreshing, its token lapses, and the session ages out on schedule.

**Rejected: sliding on every authenticated request.** It measures traffic, not
presence, and costs a Redis write per request.

**Rejected: a refresh timer that fires unconditionally.** It keeps a forgotten
tab's session alive indefinitely, which makes "idle timeout" mean "a tab is
open".

### A server subpath for `@r10c/shells-next-common`

The shared refresh handler cannot ship from the package's main entry: rollup
emits one bundle with a `"use client"` banner, so a route handler pulled in
through it becomes a client reference and its `next/server` imports fail. A
second rollup entry publishes `@r10c/shells-next-common/server` without the
banner, mirroring the `./server` subpath `shells-next-i18n` already had.

Anything a **server layout calls directly** belongs there too — a pure function
exported from the client entry is still a client function, which surfaced as
`Attempted to call accountUrls() from the server`.

### Devices are labels, never authorization inputs

An opaque `r10c_did` cookie (256-bit, httpOnly, ~2 years) plus a label parsed
with `userAgent()` from `next/server` — already bundled with Next, so no new
dependency, and notably not `ua-parser-js`, whose v2 is AGPL/dual-licensed.

**Rejected: JS fingerprinting (FingerprintJS et al.).** ~40–60% accuracy, a paid
upgrade path, and it *is* fingerprinting under GDPR/ePrivacy — a consent burden
for a signal that decides nothing.

Device history is durable, in Mongo (`UserDevice`), rather than derived from live
sessions: sessions expire, so a familiar laptop would be announced as new after a
week away. A "new device" alert that cries wolf is worse than none, because it is
the only warning a user gets that their password leaked.

The rule everywhere: **a copied cookie copies the device, and that is acceptable
precisely because nothing here decides anything.** It powers the session list and
the notification; the access token authorizes.

**Rejected: comparing the device at refresh time.** The `r10c_did` cookie lives
on auth-app's origin, so in production there is nothing to compare on another
app's origin — a check that would appear to work on localhost and silently stop
working in production.

### Recovery links exist in the message and nowhere else

A `OneTimeTokenStore` port (`entifix-ts-business`, Redis adapter) keeps only the
SHA-256 of the token and redeems it with `GETDEL`, so two clicks on the same
emailed link cannot both succeed. `POST /api/auth/password/forgot` always answers
`202` — for a missing account, a suspended one, an account with no email, and a
store outage alike — because any difference turns it into a way to enumerate who
has an account here.

The link is deliberately **not** returned in a response body. To keep the flow
testable, a development `NotificationPort` writes to a Mongo outbox exposed at
`GET /api/dev/outbox`, hard-gated to 404 in production. Playwright cannot read a
stdout line, and an untested recovery flow is one that quietly rots.

Changing a password re-verifies the current one even though the caller holds a
session — a session can be an unlocked laptop or a stolen cookie — then revokes
every session *except* the caller's own. Recovery revokes *every* session without
exception, because the old password may be in someone else's hands right now.

### Lockout, with its own downside handled

Repeated failures lock sign-ins temporarily. A temporary lock is a
denial-of-service handle by construction: anyone who knows an email address can
spend failures against it. Three mitigations ship with it and are not optional —
failures count per **identifier + source** and only escalate to an
identifier-wide lock once several sources have failed; the lock **expires on its
own**; and tripping it **notifies the owner**, once, on the transition.

A lock answers `429`, not `401`: the credentials were never consulted, and a
caller told "invalid credentials" goes off resetting a password that was fine.
Lock state is Redis with a TTL, deliberately *not* `UserStatus.Suspended`, which
is an administrator's lasting decision.

## Consequences

- Tuning session behaviour is a one-file change, and the documented next step is
  for those constants to become defaults overridden by `session.*` rows in
  config-service.
- `SessionStore` grew a read side (`listForUser`) and `revokeAllForUserExcept`;
  `AccountRepository` grew `writePasswordHash` and `findContactAddress` — the
  latter because `AuthSubject.subject` is the canonical user id, so using it as a
  recipient would have addressed security mail to a UUID.
- Administrators can view and end any user's sessions, behind
  `authn:user-device:read|write` derived from the entity. That is another
  person's device and IP history, so it is granted deliberately rather than
  folded into `user-identity:read`.
- Still deferred: WebAuthn/passkeys, per-refresh session-id rotation, IP
  geolocation, and a real mail transport (one adapter, no use-case changes).
