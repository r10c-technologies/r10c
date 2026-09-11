import type { Entity, FilterGroup } from '@r10c/entifix-ts-core';
import type { RequestPrincipal } from '@r10c/shells-effect-service';

/**
 * Whose settlement records a caller may read.
 *
 * The `settlement` store is **control** plane: one database, named at boot,
 * holding every vendor's negotiated terms and every payout the platform has
 * calculated. So as in order-service next door there is no tenant handle doing
 * the isolation, and the predicate *is* the boundary — the discriminator-column
 * shape `docs/_shared/planes.md` warns makes every missing filter a silent
 * breach.
 *
 * ⚠️ **The thing being protected here is sharper than an order.** An
 * `Agreement` is what the platform charges one vendor, and a competitor
 * learning it is a commercial injury with no undo. This is the hole ADR 0054
 * withheld the payment read grant for rather than shipping unscoped, and the
 * grant here exists only because the scope does.
 *
 * ⚠️ **`vendorId` is `filterable`**, so a client can already send
 * `rsql=vendorId==<somebody>` — and a client that can send that can send
 * somebody else's. Scoping a read to the caller is the route's job, never the
 * query string's; what makes it safe is that the scope is **conjoined** onto the
 * load request rather than trusted to replace what the caller sent.
 *
 * Simpler than the order's in one way worth stating: `vendorId` is a top-level
 * member on all three readable entities, so there is no dotted path into a
 * `composition` and no cast to reach it.
 */
export type SettlementScope =
  /** Platform staff: every record, no predicate. */
  | { readonly kind: 'unscoped' }
  /** A vendor: their own terms, their own ledger lines, their own payouts. */
  | { readonly kind: 'vendor'; readonly vendorId: string }
  /**
   * No record at all — a vendor session with no organization, or a buyer, who
   * has no settlement relationship with the platform at all.
   *
   * A case of its own rather than an empty predicate: "match nothing" has no
   * natural spelling in the filter grammar, and answering an empty page never
   * reaches Mongo.
   */
  | { readonly kind: 'nothing' };

/**
 * A record narrow enough to be tested against a scope.
 *
 * All three readable entities carry `vendorId`, so one shape covers them and the
 * by-id route needs no per-entity branch.
 */
export interface VendorScoped {
  readonly vendorId: string;
}

/**
 * The two `partyRole` values that change the answer, as ADR 0015 named them.
 *
 * ⚠️ **`partyRole` selects a predicate; it grants nothing.** The route ahead of
 * this still requires the entity's own `read` permission, so a party role on its
 * own opens no agreement — and it arrives on the same verified token `roles`
 * does, minted by auth-service from the party store and never settable by a
 * caller.
 */
const OPERATOR = 'operator';
const VENDOR = 'vendor';

/**
 * The scope a verified principal reads settlement records in.
 *
 * Everything unrecognised falls to a **narrower** answer rather than a wider
 * one. A vendor session that lost its organization cannot identify its own
 * records, and a buyer has none — `nothing` is the safe direction to be wrong
 * in, the same rule entitlements follow.
 *
 * ⚠️ **There is no buyer arm here, and its absence is the point.** In
 * order-service a buyer falls through to their own receipts; settlement holds
 * nothing a buyer is party to, so the same fall-through would be a bug wearing
 * the shape of symmetry.
 */
export const settlementScopeFor = (
  principal: RequestPrincipal,
): SettlementScope => {
  if (principal.partyRole === OPERATOR) {
    return { kind: 'unscoped' };
  }
  if (principal.partyRole === VENDOR) {
    return principal.organizationId === undefined
      ? { kind: 'nothing' }
      : { kind: 'vendor', vendorId: principal.organizationId };
  }
  return { kind: 'nothing' };
};

/**
 * The predicate for a scope, or `undefined` when there is nothing to narrow.
 *
 * `undefined` means *add no filter*, which is only ever the operator's case —
 * `nothing` never reaches here, because a route answers it without loading.
 */
export const settlementScopeFilter = <TEntity extends Entity & VendorScoped>(
  scope: SettlementScope,
): FilterGroup<TEntity> | undefined =>
  scope.kind === 'vendor'
    ? {
        operator: 'and',
        values: [
          {
            property: 'vendorId',
            operator: 'eq',
            value: scope.vendorId as never,
          },
        ],
      }
    : undefined;

/**
 * Whether one loaded record falls inside a scope.
 *
 * `id` is the single member that is neither sortable nor filterable, so a by-id
 * read cannot be expressed as a filtered load and the record is tested after it
 * is read. A caller outside the scope gets the route's existing `404` — **not** a
 * `403`, which would confirm to somebody who may not see an agreement that the
 * vendor it belongs to has one.
 */
export const settlementInScope = (
  scope: SettlementScope,
  record: VendorScoped,
): boolean => {
  switch (scope.kind) {
    case 'unscoped':
      return true;
    case 'vendor':
      return record.vendorId === scope.vendorId;
    default:
      return false;
  }
};
