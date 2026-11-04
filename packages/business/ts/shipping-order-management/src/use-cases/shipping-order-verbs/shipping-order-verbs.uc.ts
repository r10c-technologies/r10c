import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { FlowNotStarted } from '@r10c/business-ts-flow-contracts';
import { Effect } from 'effect';

import { ShippingOrder } from '../../entities/shipping-order';
import { ShippingOrderNotTransitionable } from '../../failures/shipping-failures';
import type { ShippingStatus } from '../../values/shipping-status';
import {
  shippingStatusAfter,
  type ShippingTransition,
} from '../../values/shipping-transition';

/** What a verb decides: the status the shipment moves to. */
export interface ShippingDecision {
  readonly from: ShippingStatus;
  readonly to: ShippingStatus;
}

/**
 * The one rule every verb applies: the move is legal from where the shipment
 * stands, or it is refused. The store then writes it conditional on `from`,
 * so a racing move that got there first wins and this one is refused there.
 */
export const decideShippingMove = (
  order: Pick<ShippingOrder, 'id' | 'status'>,
  transition: ShippingTransition,
): Effect.Effect<ShippingDecision, ShippingOrderNotTransitionable> => {
  const to = shippingStatusAfter(order.status, transition);
  return to === undefined
    ? Effect.fail(
        new ShippingOrderNotTransitionable({
          shippingOrderId: String(order.id),
          standing: order.status,
          transition,
        }),
      )
    : Effect.succeed({ from: order.status, to });
};

/**
 * Hand the parcel to a courier — the vendor's act, and the delivery flow's
 * pivot: after it the goods are gone and only a return brings them back.
 */
@useCase({
  entity: ShippingOrder,
  key: 'dispatch',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:shipping-order.useCases.dispatch',
  recipe: 'delivery',
  // A dispatch starts the delivery flow, whose pivot is the dispatch itself:
  // the verb answers `202` once the flow started, and a hold that won the
  // race arrives as the flow's failure (ADR 0070, ADR 0073).
  errors: [NotFound, ShippingOrderNotTransitionable, FlowNotStarted],
})
export class DispatchShippingOrderUC {
  static run(order: Pick<ShippingOrder, 'id' | 'status'>) {
    return decideShippingMove(order, 'dispatch');
  }
}

/** The courier reports the parcel delivered (and, for COD, the cash taken). */
@useCase({
  entity: ShippingOrder,
  key: 'record-delivery',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:shipping-order.useCases.record-delivery',
  errors: [NotFound, ShippingOrderNotTransitionable],
})
export class RecordDeliveryUC {
  static run(order: Pick<ShippingOrder, 'id' | 'status'>) {
    return decideShippingMove(order, 'record-delivery');
  }
}

/** The buyer refused the parcel at the door. */
@useCase({
  entity: ShippingOrder,
  key: 'record-refusal',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:shipping-order.useCases.record-refusal',
  errors: [NotFound, ShippingOrderNotTransitionable],
})
export class RecordRefusalUC {
  static run(order: Pick<ShippingOrder, 'id' | 'status'>) {
    return decideShippingMove(order, 'record-refusal');
  }
}

/** The parcel is back on the vendor's shelf. */
@useCase({
  entity: ShippingOrder,
  key: 'record-return',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:shipping-order.useCases.record-return',
  errors: [NotFound, ShippingOrderNotTransitionable],
})
export class RecordReturnUC {
  static run(order: Pick<ShippingOrder, 'id' | 'status'>) {
    return decideShippingMove(order, 'record-return');
  }
}

/** The permissions these verbs derive. Import them; never retype a verb. */
export const DISPATCH_SHIPPING_ORDER = permissionForUseCase(
  DispatchShippingOrderUC,
);
export const RECORD_DELIVERY = permissionForUseCase(RecordDeliveryUC);
export const RECORD_REFUSAL = permissionForUseCase(RecordRefusalUC);
export const RECORD_RETURN = permissionForUseCase(RecordReturnUC);
