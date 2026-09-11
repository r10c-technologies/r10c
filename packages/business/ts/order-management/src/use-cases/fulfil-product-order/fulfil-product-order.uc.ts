import { permissionForUseCase } from '@r10c/business-ts-authz';
import { EntifixLogicError, useCase } from '@r10c/entifix-ts-core';

import { ProductOrder } from '../../entities/product-order';
import {
  type FulfillableLine,
  fulfilLines,
  type FulfilmentScope,
  orderStatusAfter,
  statusAfterFulfilling,
} from '../../values/order-transition';

/**
 * Record that the lines a vendor owes on this order have been delivered.
 *
 * **A verb rather than a shape of `write`**, for the same reason
 * `sales-channel:sell` is one: `ROLE_PERMISSIONS` says no role holds
 * `order-management:product-order:write` and none is coming, because an order is
 * written by the checkout saga behind a crossing token. Delivering the goods is
 * still somebody's act, though, and it is the vendor's — so the authority is
 * named here rather than smuggled in as a save
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md) §1).
 *
 * **`entity`-bound and `context-independent`**: its subject is one order, and
 * the affordance belongs in that order's form header. There is no `alsoAt` row
 * or bulk cell — fulfilment is per line and a bulk verb acts on whole records,
 * so a "fulfil these five orders" button would quietly mean something different
 * from the one on the form.
 *
 * No `confirm`. Nothing moves and nothing is lost: a stamp already written is
 * never rewritten, so the worst a mistaken click achieves is recording a
 * delivery a day early, which the vendor fixes by talking to their customer
 * rather than by a dialog.
 */
@useCase({
  entity: ProductOrder,
  key: 'fulfil',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-order.useCases.fulfil',
})
export class FulfilProductOrderUC {
  /**
   * Stamp the lines in scope and say what the order becomes.
   *
   * ⚠️ **It returns the lines rather than mutating the order.** A line off the
   * wire is a plain object rather than an `OrderItem` — `deserializeSingleEntity`
   * assigns the embedded array through — so nothing here may construct one or
   * test `instanceof`, and the caller writes the whole array back in one
   * conditional update beside the status.
   *
   * ⚠️ **`scope` is `undefined` for an operator and an organization id for a
   * vendor**, and it comes from the verified principal at the route. A scope
   * read off a request body would let any vendor stamp another's lines.
   */
  static run<TLine extends FulfillableLine>(
    order: Pick<ProductOrder, 'status'>,
    lines: readonly TLine[],
    scope: FulfilmentScope,
    at: Date,
  ): { readonly lines: readonly TLine[]; readonly status: string } {
    if (orderStatusAfter(order.status, 'fulfil') === undefined) {
      throw new EntifixLogicError(
        'Only a paid order can be fulfilled',
        undefined,
        { status: order.status },
      );
    }

    const stamped = fulfilLines(lines, scope, at);
    return {
      lines: stamped.lines,
      status: statusAfterFulfilling(stamped.lines),
    };
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `fulfil` is written.
 */
export const FULFIL_PRODUCT_ORDER = permissionForUseCase(FulfilProductOrderUC);
