import { permissionForUseCase } from '@r10c/business-ts-authz';
import { EntifixLogicError, useCase } from '@r10c/entifix-ts-core';

import { ProductOrder } from '../../entities/product-order';
import { orderStatusAfter } from '../../values/order-transition';

/**
 * The code a route renders when a vendor asks to cancel an order that is not
 * theirs alone.
 *
 * A **code, not a sentence**: the browser resolves it through the shared
 * `errors` catalog and `@r10c/i18n-check` fails the build on one the catalog
 * lacks. Neither types nor locale parity can see a missing code — the render
 * path casts the typed-key gate away, and a code absent from both locales is
 * symmetric — so that check is the only thing looking.
 */
export const MULTI_VENDOR_ORDER = 'multiVendorOrder';

/** The code a route renders when the order is no longer in a cancellable state. */
export const ORDER_NOT_CANCELLABLE = 'orderNotCancellable';

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
 * also names somebody else gets {@link MULTI_VENDOR_ORDER} rather than a
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
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:product-order.useCases.cancelConfirm',
  },
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
    order: Pick<ProductOrder, 'status'>,
    lines: readonly { vendorId: string }[],
    scope: string | undefined,
  ): void {
    // ⚠️ **Who may act is decided before what the record is doing**, and the
    // order of these two is deliberate. A vendor who will never be allowed to
    // cancel a shared basket should be told that, not told to come back later —
    // "not cancellable right now" reads as a retry, and there is no moment at
    // which this one succeeds.
    if (scope !== undefined && lines.some(line => line.vendorId !== scope)) {
      throw new EntifixLogicError(
        'A vendor cannot cancel an order that names another vendor',
        undefined,
        { code: MULTI_VENDOR_ORDER },
      );
    }

    if (orderStatusAfter(order.status, 'claim-cancel') === undefined) {
      throw new EntifixLogicError(
        'Only a paid order can be cancelled',
        undefined,
        { status: order.status, code: ORDER_NOT_CANCELLABLE },
      );
    }
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table, which is the only other
 * place the string `cancel` is written.
 */
export const CANCEL_PRODUCT_ORDER = permissionForUseCase(CancelProductOrderUC);
