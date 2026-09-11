import type { EntifixError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { PaymentMethod } from '../values/payment-method';

/**
 * What a provider is asked to move, and on whose behalf.
 *
 * `paymentId` rather than an opaque handle: it is this platform's own id for the
 * attempt, and a real adapter sends it as the provider's idempotency key. That
 * is what stops a retried capture taking the money twice at the far end, where
 * our own command inbox cannot reach.
 */
export interface PaymentRequest {
  readonly paymentId: string;
  readonly orderId: string;
  /** Minor units, matching {@link Payment.amount}. */
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: PaymentMethod;
  /**
   * The provider's own id for an earlier step of the same attempt — present on a
   * capture that follows an authorization, absent on a first call.
   */
  readonly providerReference?: string;
}

/** How the provider answered. */
export interface PaymentProviderOutcome {
  /**
   * Deliberately **not** the full {@link PaymentStatus} union: a provider never
   * answers `pending`, which is the state a record is in before anyone was
   * asked. Widening this to the entity's own enum would make an unreachable
   * value expressible and every consumer branch on it.
   *
   * ⚠️ **`'refunded'` is deliberately not a member here.** Widening this one
   * union to cover every call was the first shape tried, and the compiler
   * refused it at the capture route: `payment.status = outcome.status` stopped
   * typechecking, which is the type system saying a capture could now answer
   * with a refund's outcome. {@link RefundProviderOutcome} carries that member
   * instead, so the mistake is unwritable rather than caught in review
   * ([ADR 0058](../../../../../docs/adr/0058-the-order-after-payment.md)).
   */
  readonly status: 'authorized' | 'captured' | 'failed';
  /** The provider's own id for the attempt. Absent for cash, and on a refusal. */
  readonly providerReference?: string;
  /** Why a `failed` failed, when the provider said. */
  readonly failureReason?: string;
}

/**
 * How the provider answered a {@link PaymentProvider.refund}.
 *
 * Everything but the status is the same fact it is for a capture, so the two
 * share a shape by extension rather than by copy — the duplication a second
 * standalone interface would carry is exactly what `Omit` here avoids, and the
 * one member that genuinely differs is the one member written out.
 */
export interface RefundProviderOutcome extends Omit<
  PaymentProviderOutcome,
  'status'
> {
  readonly status: 'refunded' | 'failed';
}

/**
 * Taking money, behind a port.
 *
 * ⚠️ **`authorize` and `capture` are two operations, and collapsing them is the
 * mistake this port exists to prevent.** They are what a real payment service
 * provider distinguishes — a hold taken at checkout and settled on dispatch —
 * and a single `pay` would make the eventual adapter model something the domain
 * cannot express ([ADR 0022](../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * ⚠️ **The separation is not academic here.** Roughly a fifth of Guatemalan
 * e-commerce is *contra entrega*: the money arrives at the courier's hand, days
 * after the order. That settles authorization now and capture later, through a
 * third party, which is only sayable if the two are separate calls. v1 does not
 * build that flow; it declines to make it unbuildable.
 *
 * ⚠️ **Never `Promise`-shaped, and never throwing.** A provider failure is an
 * outcome — `status: 'failed'` with a reason — not an error channel. The error
 * channel is for *not reaching* the provider, which is a different thing the
 * saga treats differently: a refusal compensates the flow, an unreachable
 * provider is retried.
 *
 * v1 provides a simulated adapter. Swapping in a live PSP is a `Layer` at a
 * composition root and nothing else changes.
 */
export interface PaymentProvider {
  authorize(
    request: PaymentRequest,
  ): Effect.Effect<PaymentProviderOutcome, EntifixError>;
  capture(
    request: PaymentRequest,
  ): Effect.Effect<PaymentProviderOutcome, EntifixError>;
  /**
   * Money back for a capture that already happened.
   *
   * ⚠️ **There is no `void` beside it, and the distinction is the provider's
   * own.** Voiding cancels an authorization before any money moved; refunding
   * returns money that did. v1 captures at checkout, so nothing is ever left
   * authorized-and-unsettled and a void would have nothing to act on.
   *
   * `request.providerReference` is the **capture's** reference, which is what a
   * real adapter refunds against; the outcome carries the refund's own.
   */
  refund(
    request: PaymentRequest,
  ): Effect.Effect<RefundProviderOutcome, EntifixError>;
}

export class PaymentProviderTag extends Context.Tag('PaymentProviderTag')<
  PaymentProviderTag,
  PaymentProvider
>() {}
