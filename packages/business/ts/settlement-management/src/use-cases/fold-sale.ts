import type { DomainEvent } from '@entifix/core';
import { readPaymentOutcome } from '@r10c/business-ts-payment-contracts';
import { Effect } from 'effect';

import { type FoldOutcome, SaleJoinTag } from '../ports/settlement-ports';
import { commissionsForOrder } from '../values/commission';
import { readCancelledOrder, readPlacedOrder } from '../values/placed-order';

const logOutcome = (event: string, orderId: string, outcome: FoldOutcome) => {
  if (outcome.kind === 'written') {
    const annotations = { event, orderId };
    return Effect.andThen(
      outcome.folded > 0
        ? Effect.logInfo('folded a sale into commission entries').pipe(
            Effect.annotateLogs({ ...annotations, entries: outcome.folded }),
          )
        : Effect.void,
      outcome.reversed > 0
        ? Effect.logInfo('reversed the commission entries for a sale').pipe(
            Effect.annotateLogs({ ...annotations, entries: outcome.reversed }),
          )
        : Effect.void,
    );
  }
  return outcome.kind === 'duplicate'
    ? Effect.logDebug('skipped a redelivered settlement message').pipe(
        Effect.annotateLogs({ event, orderId }),
      )
    : Effect.logDebug('holding a sale until its other half arrives').pipe(
        Effect.annotateLogs({ event, orderId }),
      );
};

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
 * ⚠️ A vendor with no agreement is **logged, not priced**: guessing a default
 * rate would invent a commercial term nobody negotiated. The sale still joins,
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
    if (unpriced.length > 0) {
      yield* Effect.logError(
        'sold for a vendor with no agreement on file',
      ).pipe(
        Effect.annotateLogs({ orderId: order.orderId, vendors: unpriced }),
      );
    }
    const outcome = yield* join.contribute(
      { consumer, eventId: event.id },
      order.orderId,
      { commissions, unpriced },
    );
    yield* logOutcome(event.name, order.orderId, outcome);
    return outcome;
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
    yield* logOutcome(event.name, payment.orderId, outcome);
    return outcome;
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
    yield* logOutcome(event.name, order.orderId, outcome);
    return outcome;
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
    yield* logOutcome(event.name, payment.orderId, outcome);
    return outcome;
  });
