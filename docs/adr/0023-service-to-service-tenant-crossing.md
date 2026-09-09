# 23. A service reaching tenant storage for another party names the organization explicitly

- Status: Accepted
- Date: 2026-08-12
- Area: data
- Read when: a service needs tenant data for a party it did not pick — one named path, a service token _plus_ a route permission, no fallback and no operator branch
- Revised: 2026-09-08 — built (#73). The mechanism is two guards rather than a
  `Context.Tag`, and the crossing carries `x-crossing-token` +
  `x-organization-id`; the decision is unchanged.

## Trigger

~~Already fired in design, not yet in code.~~ **Fired** on 2026-09-08 (#73):
`POST /api/reservation` on stock-service is the first — and still the only —
crossing, so this is a running mechanism rather than a recorded decision. It was
written ahead of the code because it modifies a rule the rest of the system
depends on, and discovering that mid-checkout is how the wrong fix gets made
under time pressure.

## Context

[ADR 0022](0022-v1-marketplace-module-boundaries.md) puts `order-management` in
the platform plane and `stock-management` in the tenant plane. Checkout has to
cross that line: the buyer needs an answer now, so the reservation is a
synchronous call ([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)).

The rule that governs tenant access has no answer for it.
[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) makes tenancy
_ambient_: the handle resolves from the session's `activeOrganizationId`, and
`packages/entifix/ts/business/src/tenancy/tenant-context.ts` says so in its own
doc comment — (that file was deleted on 2026-09-08; the rule now lives on
`requireOrganization`, for the reason in the revision note below) —

> Provided **per request**, from the session's `activeOrganizationId` — never
> from a route parameter or a request body, both of which the caller controls.

A buyer's session carries no `activeOrganizationId`. It never will: a buyer is
not a member of the vendor they are buying from, and giving them one would be a
far worse breach than the problem it solved. **The organization comes from the
item**, not from the principal — the vendor that owns the offering being
reserved.

So the operation is legitimate, the caller is trusted, and the existing mechanism
cannot express it. That gap is dangerous precisely because the obvious
workarounds are cheap:

- let the resolver fall back to "any database" when no organization resolves —
  which makes the most sensitive capability in the system the _absence_ of a
  condition, the exact shape [ADR 0012](0012-operator-cross-tenant-access.md)
  rejected for operators;
- or quietly widen `TenantContextTag` to read a request body, leaving the doc
  comment in place and false.

## Decision

### There is a second way to resolve the organization, and exactly one

A request resolves the organization it acts for from **either**:

1. the session's `activeOrganizationId`, as today; or
2. an **explicit `organizationId`** in the request, accompanied by a valid
   service token **and** a narrow permission on the route.

There is no third path, no fallback, and no branch on "is this an operator". A
request that satisfies neither simply never reaches a tenant handle, and a
tenant-plane handler is never entered — which is the existing behaviour and stays
the behaviour.

The doc comment quoted above becomes false and is **rewritten**, not left to rot.
Its replacement states both paths and why the second is not a hole: an explicit
organization is only honoured when the caller has already proved it is the fleet,
so the input the caller controls is not the input that grants anything.

> **Revised 2026-09-08 (#73) — what was built, and where the wording was wrong.**
> This section said "`TenantContextTag` gains a second provider". That tag was
> exported by `entifix-ts-business` and **provided by nothing**: every tenant
> route in the fleet resolves its handle through `requireOrganization`, which
> hands the organization to the handler directly. So the second path was built as
> its sibling — `requireServiceCrossing` in `@r10c/shells-effect-service` — and
> the two guards are the two providers this section decides on. The never-used
> tag was deleted rather than left as a documented seam nothing implements, which
> is the failure the paragraph above names. The decision is untouched: two ways
> in, no third, and a handler that satisfies neither is never entered.
>
> Concretely: `x-crossing-token` carries the secret, `x-organization-id` names
> the organization, and the checks run token → permission → organization, so
> nothing is revealed to a caller that has not first proved it is the fleet.

Rejected: having `stock` take only an `offeringId` and resolve the vendor
internally. It reads as safer because no caller names an organization, but it is
the same crossing one layer down — with two disadvantages. The authorization
becomes implicit, so there is nothing to grant or audit, and `stock` would need
to read the catalog to map the id, giving a tenant-plane slice a dependency on a
store it does not own.

Rejected: moving reservations into a platform-plane store with tenant stock as a
projection. It removes the crossing, and it breaks the design that makes
reservations work: the guard `onHand - reserved >= qty` has to be one conditional
atomic write, and spanning two stores it is neither atomic nor a single write.

### The token is not `CONFIG_SERVICE_TOKEN`

A distinct `stock.serviceToken` configuration row, `is_secret: true`. Built as
`service.token` on `stock-service`, read at boot like every other parameter and
provided as `ServiceCrossingTokenTag`.

The fleet already has a shared secret — `X-Service-Token`, gating
config-service's fleet lookup, read through
`packages/shells/next/common/src/lib/config/service-token.ts`. Reusing it here
would be one line of work and would turn a single leaked secret into a
tenant-data **write** capability across every organization. The two grants are
not comparable: one reads configuration, the other mutates a vendor's stock. They
get separate secrets so that a rotation or a compromise has a bounded blast
radius.

The named upgrade path is an RS256 service token minted by auth-service — the
fleet already distributes `jwt.publicKey`, and a token with a service subject
would give the call an identity rather than a password. Deferred deliberately: it
is a mechanism to build, and the shared secret with a separate key is the
smaller correct step.

### The permission is the actual authorization

The token proves fleet membership. It does not say _what_ the caller may do —
which is the same distinction config-service already draws, where
`X-Service-Token` opens the fleet lookup and the operator CRUD is separately
gated behind `config:configuration:*`.

So the reservation route also requires `stock-management:reservation:write`, and
the crossing is only as wide as that permission. Fleet membership is not a
capability.

⚠️ **Built as a table of its own** — `SERVICE_CROSSING_PERMISSIONS`, consulted by
`serviceCrossingAllows` and by nothing else. It is deliberately not part of
`ROLE_PERMISSIONS`: `permissionsOf` expands grants by looking a _role string_ up
in that table, so a crossing permission living there would be inherited by any
access token carrying the matching string, turning a session claim into a
cross-organization write. Two tables, two lookups, and `can()` untouched. The
table also carries no wildcard segment, since a `*` there would make holding the
token the capability.

### The residual risk, recorded rather than argued away

A shared secret means **any process holding it can name any organization**. There
is no cryptographic tie between the token and the organization in the body, and
this design does not pretend otherwise.

What bounds it is the permission, the fact that only slices which need it are
configured with the key, and the audit trail. What would remove it is the RS256
upgrade above plus a claim naming the permitted scope. Recording the gap is what
stops it being re-derived as a surprise during the first security review.

### This is not ADR 0012's crossing, and the two must not merge

Both are called crossings and they are different mechanisms with different blast
radii. Conflating them would be expensive, so the distinction is stated here and
mirrored in 0012:

|                    | [ADR 0012](0012-operator-cross-tenant-access.md)      | This record                           |
| ------------------ | ----------------------------------------------------- | ------------------------------------- |
| Who crosses        | a **person** — platform staff                         | a **service** — the fleet             |
| Why                | to act on one named organization's behalf             | to follow the data it was handed      |
| Which organization | chosen by the actor                                   | determined by the item                |
| Authorized by      | `platform:organization:act-as`, held by a human       | a service token + a route permission  |
| Mechanism          | re-mint the session token with `activeOrganizationId` | explicit `organizationId` on one call |
| Audited as         | a `Crossing` record: who, why, how long               | an ordinary request log               |
| Time-boxed         | yes, ends by expiry                                   | no — it is one call                   |

The load-bearing difference: an operator crossing is **discretionary**, so it
needs a human's permission and a durable record of why. A service crossing is
**determined** — the organization is a function of the offering being reserved,
and the service has no latitude to pick another. Giving the second one the first
one's audit machinery would add cost without adding information; giving the first
one the second one's would delete the accountability that record exists for.

## Consequences

- **ADR 0006's ambient-tenancy section is amended**, not superseded. Everything
  it decides stands — organization-agnostic entities, the request-level handle,
  no tenant filter to write. What changes is that the session is now the only
  _user-facing_ resolution rather than the only resolution.
- **The most-read statement of the rule is rewritten**, because a comment that
  contradicts the code is worse than no comment. ⚠️ Revised 2026-09-08: it turned
  out the most-read statement was not `tenant-context.ts` — that file was
  imported nowhere — but the guards themselves, so the doc moved onto
  `requireOrganization` and `requireServiceCrossing` and the unused file was
  deleted.
- **A new configuration row per consuming service**, `is_secret: true`. A row
  that omits the flag is served in full from the unauthenticated
  `GET /api/config`, so the flag is the security boundary here exactly as it is
  for `jwt.privateKey`.
- **The `stock` slice's reservation _write_ is unauthenticated by session and
  authenticated by token.** It must never accept a session as an alternative:
  two accepted credentials on one route means the weaker one is the security
  level. ⚠️ Not hypothetical — `super-admin` holds `*:*:*`, which matches
  `stock-management:reservation:write`, so a route that also took a session would
  be reachable from an operator's browser tab. The reservation _reads_ beside it
  are ordinary session-guarded tenant reads, which is the opposite arrangement:
  one route, one credential, each way.
- **An audit of who called with which organization is an ordinary request log**,
  which is enough for a determined crossing and would not be enough for a
  discretionary one.

## Follow-ups (deliberately out of scope)

- The RS256 service token, replacing the shared secret with an identity.
- A scope claim naming which organizations a service token may name, which is
  what would actually close the residual risk above.
- Applying the same seam to any later platform → tenant call. There is exactly
  one today, and generalizing it before there are two would be guessing.
