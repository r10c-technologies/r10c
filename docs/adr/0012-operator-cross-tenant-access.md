# 12. Operator cross-tenant access is an audited crossing, never a bypass

- Status: Proposed
- Date: 2026-08-01
- Amended by: [ADR 0020](0020-stores-and-slices.md) — "cross-tenant reporting is
  a projection, not a crossing" becomes checkable: a reporting **Store**
  declaring `truth: projection-of:<store>` is by construction not a crossing.
- Revised: 2026-08-12 by [ADR 0023](0023-service-to-service-tenant-crossing.md) —
  distinguishes this **discretionary** operator crossing from the **determined**
  service crossing. Trigger checked and **not** fired: ADR 0022 keeps publication
  vendor-initiated and unmoderated, so no operator screen reads tenant data yet.

## Trigger

The first operator screen that must read tenant data — catalog moderation,
dispute resolution, or support acting on a vendor's behalf. Any of these promotes
this record to Accepted.

## Context

[ADR 0006](0006-multitenancy-planes-and-tenant-storage.md) gives an operator no
tenant scope: the tenant handle resolves from the session's
`activeOrganizationId`, and an operator has none. That is correct, and it is also
a problem, because vendors and operators share one back-office
([ADR 0008](0008-domain-modules-and-service-topology.md)) and operator work —
approving a catalog, resolving a dispute — requires reading exactly the data the
resolver scopes them out of.

The dangerous shortcut is obvious: let the resolver return the shared database,
or any database, when the principal is an operator. That makes a resolver bug
silently promote every vendor, and it makes the most sensitive capability in the
system the _absence_ of a condition.

## Decision

### This is not the only thing called a crossing

> **Clarified 2026-08-12 by [ADR 0023](0023-service-to-service-tenant-crossing.md).**
> A second mechanism now reaches tenant storage for a party that is not the
> principal: a platform-plane **service** reserving a vendor's stock at checkout.
> The two must not be merged, and the difference is not cosmetic.
>
> This record's crossing is **discretionary** — a person chooses an organization,
> so it needs a human's permission (`platform:organization:act-as`), a token
> re-mint, a time box, and a durable record of who and why. ADR 0023's is
> **determined** — the organization is a function of the offering being reserved,
> and the service has no latitude to pick another, so it is authorized by a
> service token plus a narrow route permission and audited as an ordinary request
> log.
>
> Giving the determined crossing this record's audit machinery would add cost
> without adding information. Giving this one the determined crossing's would
> delete the accountability this record exists for.

### Operators hold no tenant scope by default

Unchanged from ADR 0006. An operator's default reach is the control plane plus
platform plane. Tenant-plane screens show an explicit "select an organization"
state rather than a silent empty list, so the boundary is visible instead of
looking like missing data.

### Crossing is an explicit _act-as-organization_ re-mint

An operator with `platform:organization:act-as` selects an organization; the
platform re-mints the token with that `activeOrganizationId`, exactly as a
multi-organization user's own switch does
([ADR 0006](0006-multitenancy-planes-and-tenant-storage.md)).

One mechanism, two callers. The resolver stays a pure function of the session and
gains no operator branch — which is the point: there is no code path where "is an
operator" and "which database" meet.

The re-minted token carries a marker distinguishing an acting session from a
member session, so a downstream service can refuse write actions during a
crossing if a domain wants that, and so audit records are honest about who acted.

### Every crossing is recorded

Who, which organization, when, why, and for how long — appended to an audit
table in the same transaction that mints the token, the way
`configuration_audit` already works for config writes. A crossing is time-boxed
and ends by expiry, not only by an explicit exit.

Reading a vendor's data is a privileged act performed on a customer's records. It
should be as visible after the fact as a configuration change already is.

### Cross-tenant reporting is a projection, not a crossing

An operator dashboard counting orders across vendors must not iterate tenant
databases. Aggregates are projected into the platform or control plane by the
same mechanism that publishes the catalog
([ADR 0009](0009-catalog-authoring-and-publication.md)).

Crossing is for acting on **one** named organization. It is not a reporting tool,
and using it as one would make every dashboard load an audited access to every
tenant.

## Consequences

- **The most sensitive capability is one permission**, `platform:organization:act-as`,
  and it is grantable independently of seniority — which is the point of splitting
  rank from grants ([ADR 0007](0007-access-model-planes-roles-entitlements.md)).
- **Support work costs a click and leaves a record.** Slower than an implicit
  bypass, and that is the intended trade.
- **A tenant can be shown who accessed their data**, which is a compliance
  affordance that falls out for free.
- **Moderation is blocked until this lands.** Publication stays vendor-initiated
  and unmoderated in the meantime
  ([ADR 0009](0009-catalog-authoring-and-publication.md)).
- **Nothing in the resolver changes**, so this ADR adds no risk to the isolation
  property it depends on.

## Follow-ups (deliberately out of scope)

- Vendor-visible access logs.
- Just-in-time approval for a crossing (a second operator authorizes).
- Read-only crossings as a distinct, lower-privilege grant.
