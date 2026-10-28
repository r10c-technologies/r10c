import type { DomainEvent } from '@entifix/core';
import { readPaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Effect } from 'effect';

import { type FoldOutcome, SaleJoinTag } from '../ports/settlement-ports';
import { commissionsForOrder } from '../values/commission';
import { readCancelledOrder, readPlacedOrder } from '../values/placed-order';

/**
 * What one fold did, for the slice shell to log at its consumer: the use case
 * answers and never logs (ADR 0064). `unpriced` names the vendors a placed
 * order sold for with no agreement on file — always empty for the other three
 * messages.
 */
export interface FoldReport {
  readonly event: string;
  readonly orderId: string;
  readonly outcome: FoldOutcome;
  readonly unpriced: readonly string[];
}

const report = (
  event: DomainEvent,
  orderId: string,
  outcome: FoldOutcome,
  unpriced: readonly string[] = [],
): FoldReport => ({ event: event.name, orderId, outcome, unpriced });

/**
 * Each vendor once. ⚠️ `indexOf`, never `[...new Set(…)]`: the packages
 * compile with swc's `loose` spread, which spreads a `Set` as its iterator's
 * internals — and an `$in` over those matched nothing, so every vendor read as
 * having no agreement on file.
 */
const vendorsOf = (lines: readonly { readonly vendorId: string }[]) =>
  lines
    .map(line => line.vendorId)
    .filter((vendorId, index, all) => all.indexOf(vendorId) === index);

/**
 * `order.placed`: price each vendor's lines through the agreement in force.
 *
 * ⚠️ A vendor with no agreement is **reported, not priced**: guessing a
 * default rate would invent a commercial term nobody negotiated. The sale still joins,
 * so a capture is not left waiting for a pricing that will never come.
 */
export const foldPlacedOrder = (consumer: string, event: DomainEvent) =>
  Effect.gen(function* () {
    const join = yield* SaleJoinTag;
    const order = yield* readPlacedOrder(event.data);
    const agreements = yield* join.agreementsFor(vendorsOf(order.lines));
    const { commissions, unpriced } = commissionsForOrder({
      lines: order.lines,
      ...(order.channelType === undefined
        ? {}
        : { channelType: order.channelType }),
      agreements,
    });
    const outcome = yield* join.contribute(
      { consumer, eventId: event.id },
      order.orderId,
      { commissions, unpriced },
    );
    return report(event, order.orderId, outcome, unpriced);
  });

/** `payment.captured`: the money moved, so the sale is a sale. */
export const foldCapture = (consumer: string, event: DomainEvent) =>
  Effect.gen(function* () {
    const join = yield* SaleJoinTag;
    const payment = yield* readPaymentOutcome(event.data);
    const outcome = yield* join.contribute(
      { consumer, eventId: event.id },
      payment.orderId,
      { decidedAt: payment.decidedAt },
    );
    return report(event, payment.orderId, outcome);
  });

/** `order.cancelled`: the sale is off — half of its reversal. */
export const foldCancellation = (consumer: string, event: DomainEvent) =>
  Effect.gen(function* () {
    const join = yield* SaleJoinTag;
    const order = yield* readCancelledOrder(event.data);
    const outcome = yield* join.contribute(
      { consumer, eventId: event.id },
      order.orderId,
      { cancelledAt: event.at },
    );
    return report(event, order.orderId, outcome);
  });

/**
 * `payment.refunded`: the money went back — the other half. The reversal's
 * amounts are mirrored from the ledger, never re-priced from the cancelled
 * order, so terms renegotiated since the sale still leave a pair that cancels.
 */
export const foldRefund = (consumer: string, event: DomainEvent) =>
  Effect.gen(function* () {
    const join = yield* SaleJoinTag;
    const payment = yield* readPaymentOutcome(event.data);
    const outcome = yield* join.contribute(
      { consumer, eventId: event.id },
      payment.orderId,
      { refundedAt: payment.decidedAt },
    );
    return report(event, payment.orderId, outcome);
  });
