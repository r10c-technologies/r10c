import { type Permission } from './permission';
import { type Role } from './role';

/**
 * Entity domains referenced by the grant table. They mirror the `domain` passed
 * to `@entity()` in each business package — named here as constants so a domain
 * rename surfaces as one edit rather than as silently dead grants.
 */
export const CATALOG_DOMAIN = 'product-configuration-management';
export const CATALOG_REFERENCE_DOMAIN = 'catalog-reference';
export const SALES_DOMAIN = 'sales-management';
export const STOCK_DOMAIN = 'stock-management';
export const ORDER_DOMAIN = 'order-management';
export const PAYMENT_DOMAIN = 'payment-management';
export const SETTLEMENT_DOMAIN = 'settlement-management';
export const AUTHN_DOMAIN = 'authn';

/**
 * The grant table: what each role may do. This is the whole authorization
 * policy in v1 — deliberately static and readable, sitting behind the
 * `PolicyDecision` port so a richer engine can replace it without touching a
 * single call site.
 *
 * Grants are **derived at each consumer** rather than embedded in the access
 * token: the token carries only `roles`, so changing this table takes effect on
 * deploy instead of waiting out every issued token's lifetime.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // Reads the catalog in the admin app; no back-office of its own.
  user: [
    `${CATALOG_DOMAIN}:*:read`,
    `${CATALOG_REFERENCE_DOMAIN}:*:read`,
    // Seeing which counters exist, so a member of staff can be shown the one
    // they are standing at. Authoring them is an `admin` act.
    `${SALES_DOMAIN}:*:read`,
    // ⚠️ **Ringing up a sale is this role's job, not an administrative one.**
    // The verb sits on the channel rather than on the order because no role
    // holds `order-management:product-order:write` and none is coming — an
    // order is written by the checkout saga behind a crossing token. This is
    // the authority sales-service checks before presenting that token on a
    // seller's behalf (ADR 0056).
    `${SALES_DOMAIN}:sales-channel:sell`,
    // Seeing what is in stock. Recording a movement is an `admin` act — see the
    // note there for why these are named per entity rather than wildcarded.
    `${STOCK_DOMAIN}:stock-item:read`,
    `${STOCK_DOMAIN}:stock-movement:read`,
    // Reading orders. `read` only, and there is deliberately no `write` for any
    // role: an order is written by the checkout saga behind a crossing token,
    // never by a person — see the note on `admin` below.
    `${ORDER_DOMAIN}:product-order:read`,
    // ⚠️ **No `payment:read` here, and the omission is the point.**
    // `product-order:read` above is safe for this role because order-service
    // narrows the result to the caller's own records; payment-service cannot,
    // because a `Payment` carries no buyer and no vendor to key a scope on. An
    // unscoped grant would let any signed-in user read every payment on the
    // platform, so the grant waits for the scope
    // ([ADR 0054](../../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
    // Ending your **own** other sessions — the unbound sibling of
    // `revoke-sessions` below, which ends somebody else's. Every role holds it,
    // because signing yourself out everywhere is a security control the account
    // owner must always have rather than an administrative capability.
    //
    // ⚠️ It is therefore granted three times, once per role. `@r10c/slices`
    // only checks that a declared verb is granted *somewhere*, so a role added
    // later that omits this line loses self-service silently.
    `${AUTHN_DOMAIN}:user-identity:sign-out-others`,
  ],
  // Catalog authoring plus user management, bounded by the role-assignment rule.
  admin: [
    `${CATALOG_DOMAIN}:*:read`,
    `${CATALOG_DOMAIN}:*:write`,
    `${CATALOG_DOMAIN}:*:delete`,
    // Two use-case verbs on the vendor's own offering, not CRUD. Putting a
    // record in front of buyers and taking it down again are acts that a
    // generic `write` was standing in for; naming them is what lets the form
    // header offer them and a route guard say what it is guarding (ADR 0026).
    //
    // They are the **vendor's own**, which is why they sit here and not beside
    // `catalog-reference:*:retire` under `super-admin`: an offering belongs to
    // one organization and lives in that organization's own tenant database,
    // so publishing it takes nothing away from anybody else.
    //
    // Written as literals rather than imported from the use cases that declare
    // them, for this package's standing reason: it is `business:policy` and may
    // depend only on `layer:entifix`/`layer:utils`, so it cannot reach a domain
    // package. The source scan in `@r10c/slices` is what keeps these two strings
    // and the `@useCase()` declarations from drifting apart.
    `${CATALOG_DOMAIN}:product-offering:publish`,
    `${CATALOG_DOMAIN}:product-offering:unpublish`,
    // The platform vocabulary an offering is classified in: **read only**.
    // marketplace-service serves these reads to anonymous storefront traffic,
    // so granting them here is not a privilege — it only lets the nav name the
    // same permission the destination needs. Authoring stays with `super-admin`:
    // ADR 0022 makes `catalog-reference` operator-owned, because a tenant role
    // that could write it would let one vendor rewrite the browse tree every
    // other vendor is classified into.
    `${CATALOG_REFERENCE_DOMAIN}:*:read`,
    // A vendor's own selling channels, authored in full — the mirror image of
    // the line above rather than a copy of it. `catalog-reference` is read-only
    // here because it is operator-owned platform vocabulary that every vendor
    // shares; a `SalesChannel` is tenant-plane and belongs to the one
    // organization whose handle the request resolved to, so writing it can
    // reach nobody else's data (ADR 0024).
    `${SALES_DOMAIN}:*:read`,
    `${SALES_DOMAIN}:*:write`,
    `${SALES_DOMAIN}:*:delete`,
    // An owner selling at their own counter. Granted explicitly rather than
    // left to the wildcards above, which cover the three CRUD actions and not a
    // declared verb.
    `${SALES_DOMAIN}:sales-channel:sell`,
    // A vendor's own stock. ⚠️ **Named per entity, deliberately not
    // `stock-management:*:write`.** A wildcard here would also grant
    // `stock-management:reservation:write`, which is the one permission in this
    // table that a session must never carry: the reservation route is
    // authorized by a service token because the organization comes from the
    // *item* and a buyer's session names none
    // ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
    // Granting it to a role would not by itself open the route — the route
    // decides which credentials it accepts — but it would leave the weaker
    // credential one guard-swap away from being the security level, which is
    // exactly what that record forbids.
    //
    // There is also **no `stock-item:write`**, for a different reason: nothing
    // writes a `StockItem` directly. Its counters move by `$inc` over the
    // append-only ledger, so a route that saved one would be the
    // read-modify-write ADR 0010 prohibits, and a grant for it would suggest
    // such a route ought to exist.
    `${STOCK_DOMAIN}:stock-item:read`,
    `${STOCK_DOMAIN}:stock-movement:read`,
    `${STOCK_DOMAIN}:stock-movement:write`,
    // Reading the holds against one's own stock — support answering "why did
    // this buyer lose their basket?". Writing one is not a person's act.
    `${STOCK_DOMAIN}:reservation:read`,
    // Reading orders: a vendor answering "where is my customer's parcel?", an
    // operator reading a report.
    //
    // ⚠️ **No `product-order:write` for any role, and none is coming.** An order
    // is written by the checkout saga, which holds stock in a vendor's tenant
    // store before it writes anything — that is a crossing authorized by a
    // service token, not an act a session can perform. A grant here would be
    // inert against the route that exists and would suggest a save route ought
    // to, which is how a receipt becomes editable
    // ([ADR 0052](../../../../../docs/adr/0052-the-checkout-saga.md)).
    `${ORDER_DOMAIN}:product-order:read`,
    // Reading payments — reconciliation, and answering "did this actually go
    // through?". Granted here and **not** to `user`: the read is unscoped, so
    // this is a platform-wide view of every payment taken, which is an
    // administrative capability rather than a buyer's own history. The scope
    // that would let it drop a tier is ADR 0054's recorded residual.
    //
    // ⚠️ **No `payment:write` for any role, and none is coming.** A capture is
    // the checkout saga's pivot, dispatched behind a crossing token; a grant
    // here would be inert against the route that exists and would suggest a
    // save route ought to, which is how a ledger becomes editable.
    `${PAYMENT_DOMAIN}:payment:read`,
    // Reading refunds, on the same terms and for the same reason as the capture
    // above: a refund is the record that a charge was given back, and evidence
    // nobody can read is evidence that might as well not have been kept
    // ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
    //
    // ⚠️ **Named beside `payment:read` rather than widened to
    // `payment-management:*:read`.** The wildcard would sweep in whatever this
    // domain gains next, and what it gains next is the record of money moving.
    //
    // ⚠️ **No `refund:write` for any role.** Refunding is dispatched behind a
    // crossing token by the cancellation saga, exactly as a capture is; a grant
    // here would be inert against the route that exists and would suggest a save
    // route ought to.
    `${PAYMENT_DOMAIN}:refund:read`,
    // What the platform charges this vendor, what it has taken, and what it
    // owes. Granted where `payment:read` could not be, and the difference is
    // the scope: every settlement record carries a `vendorId`, so the routes
    // narrow the result to the caller's own organization and an operator's
    // session is the only one that reads across vendors
    // ([ADR 0057](../../../../../docs/adr/0057-settlement-joins-the-sale-to-its-payment.md)).
    //
    // ⚠️ **Named per entity rather than `settlement-management:*:read`.** The
    // wildcard would sweep in whatever this domain gains next, and this is the
    // domain whose records are a vendor's negotiated terms — the one place a
    // future entity should have to be granted deliberately.
    `${SETTLEMENT_DOMAIN}:agreement:read`,
    `${SETTLEMENT_DOMAIN}:commission-entry:read`,
    `${SETTLEMENT_DOMAIN}:settlement-run:read`,
    `${SETTLEMENT_DOMAIN}:vendor-payout:read`,
    // ⚠️ **No `agreement:write` for this role, and that is the point of the
    // omission.** Setting what the platform charges a vendor is one half of a
    // negotiation, and the vendor's own administrator is the other half of it —
    // an `admin` who could write this row could set their own commission to
    // zero. It is an operator act, reached through `super-admin`'s wildcard.
    //
    // ⚠️ **No `settlement-run:write` either.** Opening a run moves money for
    // every vendor on the platform at once, which is not a tenant-scoped act in
    // any sense; and no role holds a write on the ledger or the payouts, which
    // a fold produces and nobody authors.
    `${AUTHN_DOMAIN}:user-identity:read`,
    `${AUTHN_DOMAIN}:user-identity:write`,
    // Two use-case verbs, not CRUD. Changing somebody's role or status and
    // ending every session they hold are acts a generic `write` was standing in
    // for; naming them is what lets a surface offer them and a route guard say
    // what it is guarding (ADR 0026).
    //
    // Written as literals rather than imported from the use cases that declare
    // them: this package is `business:policy`, which may depend only on
    // `layer:entifix`/`layer:utils`, so it cannot reach a domain package. The
    // source scan in `@r10c/slices` is what keeps these two strings and the
    // `@useCase()` declarations from drifting apart.
    `${AUTHN_DOMAIN}:user-identity:update-aspects`,
    `${AUTHN_DOMAIN}:user-identity:revoke-sessions`,
    // The self-service half, held by every role — see the note on `user`.
    `${AUTHN_DOMAIN}:user-identity:sign-out-others`,
    // Reading identifiers is how the user list shows who an account is; it is
    // granted explicitly rather than as `authn:*:read` so a future sensitive
    // entity in this domain is not swept in by accident.
    `${AUTHN_DOMAIN}:entity-identifier:read`,
    // Seeing where a user is signed in — incident response. Note this is
    // another person's device and IP history, so it is granted deliberately and
    // not folded into `user-identity:read`.
    //
    // Read only. Ending those sessions used to ride on `user-device:write`,
    // which named the record they are listed against rather than the act; it is
    // now `user-identity:revoke-sessions` above, and nothing writes a
    // `UserDevice` through a guarded route, so the write grant is gone rather
    // than left behind to look like it still authorizes something.
    `${AUTHN_DOMAIN}:user-device:read`,
  ],
  // The developer tier: everything, including future tooling not yet modelled.
  'super-admin': [
    '*:*:*',
    // Declared explicitly although the line above already covers it.
    //
    // `*:*:*` is the catch-all for capabilities that do not exist yet; it is
    // not a substitute for naming a verb that does. `@r10c/slices` asserts that
    // every declared verb appears in some grant, and a wildcard satisfying that
    // check would make it vacuous for exactly the verbs most worth checking —
    // the ones only the operator holds.
    //
    // Retiring the shared brand and category vocabulary is `super-admin`'s
    // alone, and deliberately not `admin`'s: ADR 0022 makes `catalog-reference`
    // operator-owned, because a tenant role that could retire a brand would let
    // one vendor take a classification away from every other vendor using it.
    // The entityKey segment is wildcarded (both entities, one lifecycle); the
    // **action** segment is not, which is what keeps ADR 0026's residual intact
    // — no role but `super-admin` wildcards an action, so a new verb still
    // escalates to nobody.
    `${CATALOG_REFERENCE_DOMAIN}:*:retire`,
    // The operator's own sessions, for the same reason: this is not a capability
    // `*:*:*` should be the only thing granting, because the day somebody
    // narrows that wildcard nobody should discover it by being unable to sign
    // themselves out.
    `${AUTHN_DOMAIN}:user-identity:sign-out-others`,
  ],
};
