import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { FlowNotStarted } from '@r10c/business-ts-flow-contracts';
import { Effect } from 'effect';

import { ProductOrder } from '../../entities/product-order';
import { OrderNotCancellable } from '../../failures/order-failures';
import {
  orderStatusAfter,
  statusesBefore,
} from '../../values/order-transition';

/**
 * Cancel one vendor's order: claim it, refund its share of the capture, put its
 * goods back, close it.
 *
 * **Per vendor order, and a vendor may cancel their own.** Before checkout
 * groups an order spanned sellers, so a vendor could not cancel a shared basket
 * at all; now each vendor's order is theirs alone,
 * the refund draws on that order's allocation only, and the other sellers'
 * orders in the group are untouched
 * ([ADR 0069](../../../../../../docs/adr/0069-a-checkout-group-of-per-vendor-orders.md)).
 *
 * Which orders a caller may reach is decided before this runs, by the vendor
 * narrowing; what is left to decide is whether the order is still cancellable.
 */
@useCase({
  entity: ProductOrder,
  key: 'cancel',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-order.useCases.cancel',
  // Offered only where the claim would land — read off the transition table,
  // so the order's form and its store agree on when a cancel is possible.
  availableWhen: { member: 'status', in: statusesBefore('claim-cancel') },
  recipe: 'cancellation',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-order.useCases.cancelConfirm',
  },
  // A refund cannot be taken back, so the reader is asked first.
  reversible: 'confirm',
  // A refund refused, or an order that moved on, arrives as the flow's
  // failure: the verb answers `202` once it has started the flow (ADR 0073).
  errors: [NotFound, OrderNotCancellable, FlowNotStarted],
})
export class CancelProductOrderUC {
  static run(
    order: Pick<ProductOrder, 'id' | 'status'>,
  ): Effect.Effect<void, OrderNotCancellable> {
    if (orderStatusAfter(order.status, 'claim-cancel') === undefined) {
      return Effect.fail(
        new OrderNotCancellable({
          orderId: String(order.id),
          reason: `an order in '${order.status}' cannot be cancelled`,
        }),
      );
    }
    return Effect.void;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb.
 */
export const CANCEL_PRODUCT_ORDER = permissionForUseCase(CancelProductOrderUC);
