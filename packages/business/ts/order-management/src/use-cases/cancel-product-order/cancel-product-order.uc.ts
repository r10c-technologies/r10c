import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { RefundDeclined } from '@r10c/business-ts-payment-contracts';
import { Effect } from 'effect';

import { ProductOrder } from '../../entities/product-order';
import {
  MultiVendorOrder,
  OrderNotCancellable,
} from '../../failures/order-failures';
import { orderStatusAfter } from '../../values/order-transition';

/**
 * Undo a paid order: refund the buyer, put the goods back, close the record.
 *
 * **A verb rather than a delete.** `DELETE /api/product-order/:id` already
 * exists and is a *compensation* — it undoes a checkout step that should not
 * have happened, leaving no trace because there was nothing to trace. A
 * cancellation is the opposite: money moved, goods moved, and every one of those
 * movements keeps its own record. Collapsing the two would authorize erasing the
 * evidence that a customer was charged
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * **Per order, never per line**, and the asymmetry with `fulfil` beside it is
 * deliberate. A promise is kept per vendor, so fulfilment divides; a
 * cancellation moves money that was taken once, for the whole basket, on one
 * capture. Partial cancellation of a multi-vendor order is out of scope and is a
 * decision rather than a gap — which is why a vendor cancelling an order that
 * also names somebody else gets {@link MultiVendorOrder} rather than a
 * cancellation of their own share.
 *
 * **`entity`-bound and `context-independent`**: its subject is one order and the
 * affordance belongs in that order's form header.
 *
 * `confirm` is `destructive`, because money moves and nothing here is
 * reversible: un-refunding is charging a customer again.
 */
@useCase({
  entity: ProductOrder,
  key: 'cancel',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-order.useCases.cancel',
  recipe: 'cancellation',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-order.useCases.cancelConfirm',
  },
  errors: [NotFound, MultiVendorOrder, OrderNotCancellable, RefundDeclined],
})
export class CancelProductOrderUC {
  /**
   * The two rules this domain owns about starting a cancellation.
   *
   * ⚠️ **It decides, and starts nothing.** What follows a cancellation is a
   * refund in another service and a stock movement in a third, so the flow is a
   * saga and this is only the authority check in front of it. A use case that
   * dispatched would have to name two other domains, which a `business:domain`
   * package may not import.
   *
   * ⚠️ **`scope` is `undefined` for an operator and an organization id for a
   * vendor**, from the verified principal at the route. A vendor may cancel only
   * an order *all* of whose lines name their organization.
   */
  static run(
    order: Pick<ProductOrder, 'id' | 'status'>,
    lines: readonly { vendorId: string }[],
    scope: string | undefined,
  ): Effect.Effect<void, MultiVendorOrder | OrderNotCancellable> {
    const orderId = String(order.id);
    // ⚠️ **Who may act is decided before what the record is doing**, and the
    // order of these two is deliberate. A vendor who will never be allowed to
    // cancel a shared basket should be told that, not told to come back later —
    // "not cancellable right now" reads as a retry, and there is no moment at
    // which this one succeeds.
    if (scope !== undefined && lines.some(line => line.vendorId !== scope)) {
      return Effect.fail(new MultiVendorOrder({ orderId }));
    }
    if (orderStatusAfter(order.status, 'claim-cancel') === undefined) {
      return Effect.fail(
        new OrderNotCancellable({
          orderId,
          reason: `an order in '${order.status}' cannot be cancelled`,
        }),
      );
    }
    return Effect.void;
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `cancel` is written.
 */
export const CANCEL_PRODUCT_ORDER = permissionForUseCase(CancelProductOrderUC);
