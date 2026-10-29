import type { TransitionalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { Agreement } from '../entities/agreement';
import type { VendorCommission } from '../values/commission';

/**
 * One half of a sale, as one message contributes it. The sale itself is
 * `order.placed` (the lines, priced) joined with `payment.captured` (that money
 * moved); its reversal is `order.cancelled` joined with `payment.refunded`.
 * No message in either pair is sufficient alone.
 */
export type SaleHalf =
  | {
      readonly commissions: readonly VendorCommission[];
      readonly unpriced: readonly string[];
    }
  | { readonly decidedAt: string }
  | { readonly cancelledAt: string }
  | { readonly refundedAt: string };

/** What contributing a half did. */
export type FoldOutcome =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'duplicate' }
  | {
      readonly kind: 'written';
      readonly folded: number;
      readonly reversed: number;
    };

/**
 * The join behind the commission ledger (ADR 0057, 0058 §9).
 *
 * ⚠️ **Both pairs land on one join record per order**, and the reversal will
 * not run until the sale has: a reversal cannot precede the sale it mirrors.
 * Whichever message completes a pair writes its entries, in the same unit as
 * that message's claim, so a redelivery folds nothing twice.
 */
export interface SaleJoin {
  /** Each vendor's agreement in force, newest first. */
  readonly agreementsFor: (
    vendorIds: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, Agreement>, TransitionalFailure>;
  readonly contribute: (
    claim: { readonly consumer: string; readonly eventId: string },
    orderId: string,
    half: SaleHalf,
  ) => Effect.Effect<FoldOutcome, TransitionalFailure>;
}

export class SaleJoinTag extends Context.Service<SaleJoinTag, SaleJoin>()(
  'SaleJoinTag',
) {}

/** What one settlement pass did. */
export type RunOutcome =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'calculated';
      readonly runId: string;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly payouts: number;
      readonly entries: number;
    };

/**
 * Settles what the ledger holds unsettled: one run, a payout per vendor — the
 * gross less the cut, and possibly negative — all in one unit. It announces
 * nothing, since no slice subscribes to a completed run (ADR 0068).
 */
export interface SettlementRunStore {
  readonly settleOnce: () => Effect.Effect<RunOutcome, TransitionalFailure>;
}

export class SettlementRunStoreTag extends Context.Service<
  SettlementRunStoreTag,
  SettlementRunStore
>()('SettlementRunStoreTag') {}
