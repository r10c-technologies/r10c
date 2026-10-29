import {
  type ResolutionRule,
  type VerifiedContext,
  When,
} from '@entifix/business';
import type { EntityMemberPath, FilterGroup } from '@entifix/core';

import type { ProductOrder } from '../entities/product-order';

/**
 * What the scope is decided from: the verified principal's routing context.
 * Structural, so this domain names no HTTP framework — any principal with
 * these members will do.
 */
export interface ScopedCaller {
  readonly partyRole?: string;
  readonly organizationId?: string;
  readonly partyId?: string;
}

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
 * Typed, not cast: entifix's `EntityMemberPath` names one step into a member
 * that holds an array of records, and types the value from the line.
 */
const VENDOR_PATH = 'items.vendorId' satisfies EntityMemberPath<ProductOrder>;

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
export const orderScopeFor = (principal: ScopedCaller): OrderScope => {
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
/** Which orders a caller may see: all, none, or the ones a filter keeps. */
export type OrderNarrowing = 'unscoped' | 'nothing' | FilterGroup<ProductOrder>;

/**
 * Every order read narrowed to its caller (ADR 0053, as a resolver since ADR
 * 0065), the reads' twin of {@link orderScopeFor}: platform staff unscoped, a
 * vendor to the orders that owe them a line, a buyer to the orders they placed,
 * and anybody matching no rule — a vendor session with no organization, an
 * account with no party record — to nothing. The by-id read is a load of the
 * same narrowing, so the list and the read cannot disagree.
 */
export const orderNarrowing: readonly ResolutionRule<
  (context: VerifiedContext) => OrderNarrowing
>[] = [
  When(context => context.partyRole === OPERATOR).use({
    name: 'operator',
    impl: () => 'unscoped',
  }),
  When(
    context =>
      context.partyRole === VENDOR && context.organizationId !== undefined,
  ).use({
    name: 'vendor',
    impl: context => ({
      operator: 'and',
      values: [
        {
          property: VENDOR_PATH,
          operator: 'eq',
          value: context.organizationId as never,
        },
      ],
    }),
  }),
  When(
    context => context.partyRole !== VENDOR && context.partyId !== undefined,
  ).use({
    name: 'buyer',
    impl: context => ({
      operator: 'and',
      values: [
        {
          property: 'buyerId',
          operator: 'eq',
          value: context.partyId as string,
        },
      ],
    }),
  }),
];
