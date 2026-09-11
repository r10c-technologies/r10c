import type { OrderStatus } from './order-status';

/**
 * The moves anyone can make on a paid order.
 *
 * Three verbs rather than one per state. `pending` and `paid` are where an order
 * *arrives* — the first is the checkout saga still in flight, the second is what
 * consuming `payment.captured` writes — so neither is anywhere a person drives
 * it to. What is left is what an order can be asked to do after the money moved
 * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * `claim-cancel` and `settle-cancel` are the two halves of one cancellation,
 * separated because a refund sits between them and cannot be undone. The claim
 * is compensatable, the settle only rolls forward.
 */
export const OrderTransitions = [
  'fulfil',
  'claim-cancel',
  'settle-cancel',
] as const;

export type OrderTransition = (typeof OrderTransitions)[number];

/**
 * The status a transition produces, or `undefined` if the move is illegal.
 *
 * A table rather than a chain of `if`s, because it is the whole rule and it
 * belongs where it can be read at a glance and tested without a database. The
 * routes call this; nothing enforces a lifecycle in a handler.
 *
 * Three entries are worth reading twice.
 *
 * **`paid` is the only state a cancellation can claim.** A `pending` order is a
 * checkout still in flight or a saga that stranded, and undoing one is the
 * coordinator's job — a second actor cancelling underneath it would race a
 * compensation already on its way. A `fulfilled` order is a return, which is
 * goods coming back and belongs to a capability this system does not have.
 *
 * **`fulfil` is legal from `paid` alone, and it yields `paid`.** The table
 * cannot express the real rule on its own: an order reaches `fulfilled` only
 * when *every* line carries a stamp, which is a fact about the lines rather than
 * about the status. {@link statusAfterFulfilling} is the half that knows, and
 * this entry exists to refuse the move from `cancelling`, `cancelled` and
 * `pending` before the lines are ever touched.
 *
 * **`cancelling → cancelling` is deliberately absent.** The claim is the
 * concurrency guard, so a second claim landing on a record already claimed must
 * fail rather than pass — that refusal *is* the lock.
 */
const TRANSITIONS: Record<
  OrderTransition,
  Partial<Record<OrderStatus, OrderStatus>>
> = {
  fulfil: {
    paid: 'paid',
  },
  'claim-cancel': {
    paid: 'cancelling',
  },
  'settle-cancel': {
    cancelling: 'cancelled',
  },
};

/** The resulting status, or `undefined` when the transition is not allowed. */
export function orderStatusAfter(
  current: OrderStatus,
  transition: OrderTransition,
): OrderStatus | undefined {
  return TRANSITIONS[transition][current];
}

/** Whether a transition is allowed from a given status. */
export function isLegalOrderTransition(
  current: OrderStatus,
  transition: OrderTransition,
): boolean {
  return orderStatusAfter(current, transition) !== undefined;
}

/**
 * Which lines a caller may stamp.
 *
 * `undefined` is an **operator**, who fulfils the whole order; a string is one
 * organization, which stamps the lines it owes and leaves the rest alone. The
 * distinction is the same one `orderScopeFor` draws at the route, and it is
 * repeated as a parameter here rather than imported so this module stays free of
 * the authorization vocabulary — a `business:domain` package may reach
 * `business:policy`, but a pure lifecycle rule has no business knowing what a
 * principal is.
 */
export type FulfilmentScope = string | undefined;

/**
 * A line, as this module needs to read and stamp it.
 *
 * Structural rather than `OrderItem` itself, because a line arriving off the
 * wire is a plain object — `deserializeSingleEntity` assigns the embedded array
 * through — so nothing that touches one may require the class.
 */
export interface FulfillableLine {
  readonly vendorId: string;
  readonly fulfilledAt?: Date;
}

/**
 * Stamp the lines in scope, and say what the order's status becomes.
 *
 * ⚠️ **The order reaches `fulfilled` only when every line carries a stamp**,
 * including the ones this caller could not touch. One order spans several
 * vendors, so an order-level `fulfilled` flipped by one of them states something
 * about another vendor's lines that is not true — which is exactly why
 * `fulfilledAt` sits on the line and the status is derived from all of them
 * (ADR 0058 §1).
 *
 * ⚠️ **A line already stamped keeps its original stamp.** Re-fulfilling is not
 * an error — a vendor clicking twice, or a retry after a timed-out response,
 * must not move the moment a promise was kept — but it must not rewrite history
 * either. The first stamp is the true one.
 *
 * It returns the lines rather than mutating them: a line off the wire is a plain
 * object rather than an `OrderItem`, and the caller writes the whole array back
 * in one conditional update.
 */
export function fulfilLines<TLine extends FulfillableLine>(
  lines: readonly TLine[],
  scope: FulfilmentScope,
  at: Date,
): { readonly lines: readonly TLine[]; readonly touched: number } {
  let touched = 0;
  const stamped = lines.map(line => {
    const inScope = scope === undefined || line.vendorId === scope;
    if (!inScope || line.fulfilledAt !== undefined) return line;
    touched += 1;
    return { ...line, fulfilledAt: at };
  });
  return { lines: stamped, touched };
}

/**
 * The status an order carries once these lines are stamped.
 *
 * Separate from {@link fulfilLines} because the caller needs both halves in one
 * update and a function returning a status is easier to read at the call site
 * than a second member on a result object.
 */
export function statusAfterFulfilling(
  lines: readonly FulfillableLine[],
): OrderStatus {
  // An order with no lines is not fulfilled by vacuous truth. It should not
  // exist — `place-order` refuses an empty basket — but `every` on an empty
  // array answers `true`, and a status derived from a shape that cannot happen
  // is exactly the kind of thing that later can.
  if (lines.length === 0) return 'paid';
  return lines.every(line => line.fulfilledAt !== undefined)
    ? 'fulfilled'
    : 'paid';
}
