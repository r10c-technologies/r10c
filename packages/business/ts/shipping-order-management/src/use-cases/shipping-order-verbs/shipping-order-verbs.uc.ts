import { permissionForUseCase } from '@entifix/authz';
import { NotFound, useCase } from '@entifix/core';
import { SelectionTooLarge } from '@r10c/business-ts-common';
import { FlowNotStarted } from '@r10c/business-ts-flow-contracts';
import { Effect } from 'effect';

import { ShippingOrder } from '../../entities/shipping-order';
import { ShippingOrderNotTransitionable } from '../../failures/shipping-failures';
import type { ShippingStatus } from '../../values/shipping-status';
import {
  shippingStatusAfter,
  type ShippingTransition,
  statusesBefore,
} from '../../values/shipping-transition';

/** The states a verb is offered in: those its move is legal from. */
const offeredFrom = (transition: ShippingTransition) => ({
  member: 'status',
  in: statusesBefore(transition),
});

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
  // A vendor with a morning's parcels dispatches them from the worklist, not
  // one record at a time: the same verb and the same permission over a
  // selection, one delivery flow per shipment, each answering its own outcome.
  alsoAt: [{ binding: 'collection', placement: 'context-dependent' }],
  labelKey: 'entity:shipping-order.useCases.dispatch',
  availableWhen: offeredFrom('dispatch'),
  emphasis: 'primary',
  // Irreversible and felt outside the record: the goods leave, and only a
  // refusal brings them back. Neutral, not destructive — it is the act the
  // worklist exists for, and nothing is deleted.
  confirm: {
    tone: 'neutral',
    messageKey: 'entity:shipping-order.useCases.dispatchConfirm',
  },
  recipe: 'delivery',
  // A dispatch starts the delivery flow, whose pivot is the dispatch itself:
  // the verb answers `202` once the flow started, and a hold that won the
  // race arrives as the flow's failure (ADR 0070, ADR 0073).
  errors: [
    NotFound,
    ShippingOrderNotTransitionable,
    FlowNotStarted,
    SelectionTooLarge,
  ],
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
  availableWhen: offeredFrom('record-delivery'),
  // The happy path, and unconfirmed: the courier's report is the evidence, and
  // a dialog in front of the commonest act trains people to click through.
  emphasis: 'primary',
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
  availableWhen: offeredFrom('record-refusal'),
  // A refusal closes the order and, for cash on delivery, ends the payment
  // that never came; it answers the delivery flow and cannot be taken back.
  confirm: {
    tone: 'neutral',
    messageKey: 'entity:shipping-order.useCases.recordRefusalConfirm',
  },
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
  availableWhen: offeredFrom('record-return'),
  // A return puts stock back on sale, which a second report cannot undo.
  confirm: {
    tone: 'neutral',
    messageKey: 'entity:shipping-order.useCases.recordReturnConfirm',
  },
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
