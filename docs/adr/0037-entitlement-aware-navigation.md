# 37. Entitlements ride the access token, and navigation reads them

- Status: Accepted
- Date: 2026-09-02
- Amends: [ADR 0002](0002-authorization-roles-and-abac.md) (its nav consequence
  named an endpoint this record deletes) and
  [ADR 0007](0007-access-model-planes-roles-entitlements.md) (its "nav filtering
  must move" consequence is now half built, and the half that is not has a
  reason).

## Context

**ADR 0007's second assignment ceiling has never been read by anything.** The
pieces are all present and all inert: `Entitlement` is an `@entity()` class in
`business-ts-access-management`, `entitlementSeedData` writes a row for the demo
organization into auth-service's control-plane Mongo, and
`isPermissionEntitled(entitledDomains, permission)` sits beside it as a pure
function with **zero callers**. No deployment even imports the package. So an
organization provisioned for nothing but the catalog still saw every link in the
back office, and would have kept seeing `stock-management` and `sales-management`
as those slices are promoted.

`visibleNav(roles)` is where that shows. It filters on `can(roles, permission)`
and nothing else, so the only ceiling navigation has ever known is the actor's
own tier.

**The other half of the ticket that prompted this was already fixed, and the
fix left something behind.** `lib/nav.ts` holds one `NAV` const; both `sidebarNav`
and `workspaceMenu` derive from one `visibleNav`. But `workspaceMenu` was served
over HTTP at `GET /api/menu`, and `git log --all -S` finds **no revision in which
anything fetched it** — the workspace deliberately reuses the sidebar's list
(`workspace-view.tsx` says so in a comment). It was not a drifting duplicate. It
was a second, untested projection of `NAV` waiting to become one.

## Decision

### `/api/menu` and `workspaceMenu` are deleted

One list, one projection, one consumer. Keeping a second projection in step with
the first, when nothing renders it, is maintenance paid for a surface that does
not exist. Nothing about this is a compatibility question: no client ever called
it.

### Entitlements ride the access token, resolved once at sign-in

`SessionScope` gains `entitlements: readonly string[]`, resolved by
`SessionScopeResolver` — which is already the one place a session's organization
is decided, and already holds the control-plane connection the row lives in. It
lands on `SessionData`, and from there on every `TokenClaims` minted from that
session. Refresh re-signs it unchanged, reading the session record.

This is the `partyRole` arrangement from
[ADR 0015](0015-asymmetric-access-tokens-and-the-party-role-claim.md), applied to
a value with the same shape: resolved from a party lookup, stable across a
session, needed by a surface that must not pay for a lookup.

**Rejected: fetching it per render.** The nav is server-rendered on every
back-office page. A fetch would put a network hop and a new failure mode on that
path to shape a menu, which is the alternative `lib/nav-principal.ts` already
documents as worse. Its advantage — freshness — buys nothing here, because nothing enforces
the ceiling yet; it only hides links.

The claim is read back **unverified**, through the same `unverifiedClaims` the
roles read already used, with the same argument: being wrong costs a menu item,
and `requirePermission` on the service is what refuses the request.

### A nav item opts in with `entitled: true`, and most do not

`GuardedNavItem` gains a boolean, not a domain name. The domain is already
written one line up in `permission`, and a second string could disagree with the
permission the route behind it actually checks — the exact drift the interface
exists to prevent. So the flag means "gate me on the domain segment of my own
permission", and `isPermissionEntitled` is reused verbatim.

**Omitting it is the right answer for most items**, which is why this is opt-in
rather than derived. An organization is not _provisioned for_ `catalog-reference`,
`config` or `authn`; `catalog-reference` in particular is never grantable at all
([ADR 0022](0022-v1-marketplace-module-boundaries.md)), because a marketplace has
to merge taxonomy and per-vendor taxonomy cannot. Deriving the gate from the
permission would have hidden the platform's own vocabulary — brands and
categories — from every vendor, and hidden Configuración and Usuarios from
everyone. Today exactly one item carries the flag: Productos.

Setting `entitled` with no `permission` **throws**. There is no domain to read,
and both possible defaults — always shown, always hidden — surface as a bug in
something else entirely: a missing grant, or a missing entitlement.

### A session with no organization is outside the ceiling, not refused by it

The skip is keyed on `activeOrganizationId`, never on the entitlement list being
empty. The two are different principals: platform staff hold no tenant scope, so
the ceiling does not apply to them; a member of an organization provisioned for
nothing is inside the ceiling and entitled to nothing. Collapsing them empties a
super-admin's sidebar, and it does so silently — every test that seeds an
organization still passes.

## Consequences

- **`unverifiedRoles` is deleted.** `navPrincipal` needs roles, organization and
  entitlements from one cookie, so it decodes once with `unverifiedClaims` — the
  shape `lib/workspace-scope.ts` already used. That left the roles-only helper
  with no callers. The mechanism and its warning are unchanged; only the spelling
  moved, and ADR 0002's paragraph naming it is corrected in place.
- **A provisioning change is stale until the next sign-in**, exactly as
  `partyRole` is. A refresh re-signs the stored value rather than re-resolving
  it, because re-resolving would put a Mongo read on a path that is deliberately
  store-only. This is acceptable _only_ while the ceiling is presentation: an
  operator who provisions a new domain must tell the customer to sign in again.
  **When something enforces the ceiling, this bound has to be revisited.**
- **`RequestPrincipal` and the Next `Principal` do not gain the field.** Nothing
  server-side reads an entitlement yet — ADR 0007's role-minting check is still
  unbuilt — and a claim on the verified principal that nothing consults is the
  same defect as the endpoint this record deletes. It lands with the enforcement.
- **`isPermissionEntitled` has a caller for the first time**, which means
  `back-office-app` now depends on `business-ts-access-management`. That is a
  legal edge (`layer:app` → `layer:business`, `scope:shared`) and it carries no
  entity or repository — the function is pure vocabulary.
- **A malformed `domains` reads as provisioned for nothing.** This is a ceiling,
  so the direction to be wrong in is the narrow one.
- **The `entitled` flag is a review obligation as slices are promoted.** M2–M6
  each add nav for a tenant-facing domain, and each of those items wants the
  flag. An item that omits it is not broken, it is ungated — which is why the
  spec asserts the operator-owned items _stay_ visible rather than only asserting
  that the gated one disappears.
