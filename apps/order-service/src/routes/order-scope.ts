import type { ProductOrder } from '@r10c/business-ts-order-management';
import type { FilterGroup } from '@r10c/entifix-ts-core';
import type { RequestPrincipal } from '@r10c/shells-effect-service';

/**
 * Whose orders a caller may read.
 *
 * The `order` store is **platform** plane: one database, named at boot, holding
 * every buyer's receipt and every vendor's lines. So unlike stock-service next
 * door there is no tenant handle doing the isolation, and the predicate *is* the
 * boundary — the discriminator-column shape `docs/_shared/planes.md` warns makes
 * every missing filter a silent breach.
 *
 * Three predicates come out of one principal, and none of them is expressible by
 * the caller. ⚠️ **`buyerId` is `filterable`**, so a client can already send
 * `rsql=buyerId==<somebody>` — and a client that can send that can send somebody
 * else's. Scoping a read to the caller is the route's job, never the query
 * string's; what makes it safe is that the scope is **conjoined** onto the load
 * request rather than trusted to replace what the caller sent.
 *
 * The scope is a value rather than a filter, so the two consumers stay one
 * decision: the list turns it into a predicate, and the by-id read — whose `id`
 * is the one member that is neither sortable nor filterable — tests a loaded
 * record against it.
 */
export type OrderScope =
  /** Platform staff: every order, no predicate. */
  | { readonly kind: 'unscoped' }
  /** A vendor: the orders that owe them a line. */
  | { readonly kind: 'vendor'; readonly organizationId: string }
  /** A buyer: the orders they placed. */
  | { readonly kind: 'buyer'; readonly partyId: string }
  /**
   * No order at all — a vendor session with no organization, or an account with
   * no party record.
   *
   * A case of its own rather than an empty predicate: "match nothing" has no
   * natural spelling in the filter grammar, and answering an empty page never
   * reaches Mongo.
   */
  | { readonly kind: 'nothing' };

/**
 * The member holding the vendor on a line.
 *
 * ⚠️ **A dotted path into a `composition`, which is legal here and nowhere
 * else.** `items` is declared unqueryable on the entity, so `coerceFiltering`
 * rejects any query string naming it; that allowlist runs at parse time and
 * nothing re-checks downstream, which is exactly what lets *server* code reach
 * an embedded path a client cannot. `translateFiltering` emits the property
 * verbatim, so Mongo matches array elements by its own semantics.
 *
 * The cast is the idiom already used for a server-authored filter naming a path
 * rather than a member (the storefront's catalog queries, and
 * marketplace-service's bulk selection).
 */
const VENDOR_PATH = 'items.vendorId' as unknown as keyof ProductOrder;

/**
 * The two `partyRole` values that change the answer, as ADR 0015 named them.
 *
 * ⚠️ **`partyRole` selects a predicate; it grants nothing.** The route ahead of
 * this still requires `order-management:product-order:read`, so a party role on
 * its own opens no order — and it arrives on the same verified token `roles`
 * does, minted by auth-service from the party store and never settable by a
 * caller. Making the operator's wider read a permission of its own is not
 * available today: the action segment of a permission is the CRUD triple or a
 * `@useCase()` verb, and `@r10c/slices` fails the build on a grant naming a verb
 * that nothing declares.
 */
const OPERATOR = 'operator';
const VENDOR = 'vendor';

/**
 * The scope a verified principal reads orders in.
 *
 * Everything unrecognised falls to a **narrower** answer rather than a wider
 * one: a vendor session that lost its organization, or an account with no party,
 * is a caller whose own records cannot be identified, and `nothing` is the safe
 * direction to be wrong in — the same rule entitlements follow.
 */
export const orderScopeFor = (principal: RequestPrincipal): OrderScope => {
  if (principal.partyRole === OPERATOR) {
    return { kind: 'unscoped' };
  }
  if (principal.partyRole === VENDOR) {
    return principal.organizationId === undefined
      ? { kind: 'nothing' }
      : { kind: 'vendor', organizationId: principal.organizationId };
  }
  return principal.partyId === undefined
    ? { kind: 'nothing' }
    : { kind: 'buyer', partyId: principal.partyId };
};

/**
 * The predicate for a scope, or `undefined` when there is nothing to narrow.
 *
 * `undefined` means *add no filter*, which is only ever the operator's case —
 * `nothing` never reaches here, because a route answers it without loading.
 */
export const orderScopeFilter = (
  scope: OrderScope,
): FilterGroup<ProductOrder> | undefined => {
  switch (scope.kind) {
    case 'vendor':
      return {
        operator: 'and',
        values: [
          {
            property: VENDOR_PATH,
            operator: 'eq',
            value: scope.organizationId as never,
          },
        ],
      };
    case 'buyer':
      return {
        operator: 'and',
        values: [
          { property: 'buyerId', operator: 'eq', value: scope.partyId },
        ],
      };
    default:
      return undefined;
  }
};

/**
 * Whether one loaded order falls inside a scope.
 *
 * `id` is the single member that is neither sortable nor filterable, so a by-id
 * read cannot be expressed as a filtered load and the record is tested after it
 * is read. A caller outside the scope gets the route's existing `404` — **not**
 * a `403`, which would confirm the order exists to somebody who may not see it.
 */
export const orderInScope = (
  scope: OrderScope,
  order: ProductOrder,
): boolean => {
  switch (scope.kind) {
    case 'unscoped':
      return true;
    case 'vendor':
      return order.items.some(item => item.vendorId === scope.organizationId);
    case 'buyer':
      return order.buyerId === scope.partyId;
    default:
      return false;
  }
};
