import type { Agreement } from '@r10c/business-ts-settlement-management';
import { EntifixBuildError } from '@r10c/entifix-ts-core';

import type { PlacedOrderLine } from './placed-order';

/** Basis points: 10000 is the whole sale, so 250 is 2.5%. */
const WHOLE_SALE_BASIS_POINTS = 10_000;

/** One vendor's share of one order, priced. */
export interface VendorCommission {
  readonly vendorId: string;
  /** Minor units: this vendor's lines, before the platform's cut. */
  readonly saleAmount: number;
  /** Minor units: what the platform takes. */
  readonly commissionAmount: number;
  readonly currency: string;
}

/**
 * Group an order's lines by the vendor that owes them.
 *
 * A `Map` keyed by vendor rather than a sort, because the fold that follows
 * needs one entry per vendor and a stable order is not one of its requirements —
 * insertion order is the order the lines arrived in, which is the order's own.
 */
const byVendor = (
  lines: readonly PlacedOrderLine[],
): Map<string, PlacedOrderLine[]> => {
  const grouped = new Map<string, PlacedOrderLine[]>();
  for (const line of lines) {
    const existing = grouped.get(line.vendorId);
    if (existing === undefined) {
      grouped.set(line.vendorId, [line]);
    } else {
      existing.push(line);
    }
  }
  return grouped;
};

/**
 * What one vendor's lines came to, and in what currency.
 *
 * ⚠️ **Mixed currencies inside one vendor's lines are refused, not summed.**
 * Adding 500 EUR to 500 GBP produces 1000 of nothing, and the commission taken
 * from that number would be charged against a real vendor. Refusing classifies
 * the message poison, which is loud; summing would be silent and wrong forever.
 *
 * Two vendors on one order using *different* currencies is fine and is not this
 * check: each gets their own entry with their own currency.
 */
const subtotalFor = (
  vendorId: string,
  lines: readonly PlacedOrderLine[],
): { amount: number; currency: string } => {
  const [first, ...rest] = lines;
  // Unreachable through `byVendor`, which only ever creates a key by pushing a
  // line onto it. Stated so the non-null assertion the alternative needs is not.
  if (first === undefined) {
    throw new EntifixBuildError(`vendor ${vendorId} has no lines`);
  }
  const currency = first.currency;
  let amount = first.amount * first.quantity;
  for (const line of rest) {
    if (line.currency !== currency) {
      throw new EntifixBuildError(
        `vendor ${vendorId} has lines in ${currency} and ${line.currency} on one order`,
      );
    }
    amount += line.amount * line.quantity;
  }
  return { amount, currency };
};

/**
 * Price one order's lines against the vendors' agreements.
 *
 * ⚠️ **The rate comes from `agreement.commissionFor(channelType)`, never from
 * indexing the rate map.** `rates[type] || fallback` charges full commission for
 * a channel whose negotiated rate is `0` — and "we take nothing on your own
 * counter" is the entire term the per-channel map exists for. `commissionFor`
 * checks for `undefined` explicitly and is tested on that case (ADR 0024, #94).
 *
 * ⚠️ **One rounding per vendor, on the vendor's subtotal.** Rounding each line
 * and summing gives a different answer, and the entry has to equal the invoice —
 * a statement whose lines do not add up to its total is a statement a vendor
 * disputes. `Math.round` rather than a floor, so the platform is not
 * systematically short by a cent on every sale in the ledger.
 *
 * ⚠️ **A vendor with no agreement is skipped and named**, never charged a
 * guessed rate. There is no default commission in this system; there is a
 * default *within* an agreement. Inventing one would put a commercial term
 * nobody negotiated into a ledger built to be defensible in a dispute.
 *
 * The channel type is the order's, not the line's: one sale comes through one
 * channel, and it is a denormalized copy on the order for exactly this reader.
 */
export const commissionsForOrder = ({
  lines,
  channelType,
  agreements,
}: {
  readonly lines: readonly PlacedOrderLine[];
  readonly channelType?: string;
  /** The agreement in force for each vendor, keyed by `vendorId`. */
  readonly agreements: ReadonlyMap<string, Agreement>;
}): {
  readonly commissions: readonly VendorCommission[];
  /** Vendors on the order that no agreement covers. */
  readonly unpriced: readonly string[];
} => {
  const commissions: VendorCommission[] = [];
  const unpriced: string[] = [];

  for (const [vendorId, vendorLines] of byVendor(lines)) {
    const agreement = agreements.get(vendorId);
    if (agreement === undefined) {
      unpriced.push(vendorId);
      continue;
    }

    const { amount, currency } = subtotalFor(vendorId, vendorLines);
    const basisPoints = agreement.commissionFor(channelType);

    commissions.push({
      vendorId,
      saleAmount: amount,
      commissionAmount: Math.round(
        (amount * basisPoints) / WHOLE_SALE_BASIS_POINTS,
      ),
      currency,
    });
  }

  return { commissions, unpriced };
};

/**
 * What one vendor is owed for a set of ledger lines: the gross less the cut.
 *
 * ⚠️ **Not the sum of the commissions.** Both entity docblocks used to describe
 * a payout as "the fold of that vendor's commission entries", which totals what
 * the platform *keeps* — the opposite of what a record named `VendorPayout`
 * means. The subtraction is why `CommissionEntry` captures `saleAmount` at all.
 *
 * Mixed currencies are refused for the reason they are refused above, one level
 * up: a payout is a single amount, and a single amount in two currencies is not
 * one.
 */
export const payoutFor = (
  vendorId: string,
  entries: readonly {
    readonly saleAmount: number;
    readonly commissionAmount: number;
    readonly currency: string;
  }[],
): { amount: number; currency: string } => {
  const [first, ...rest] = entries;
  if (first === undefined) {
    throw new EntifixBuildError(`vendor ${vendorId} has no entries to pay`);
  }
  const currency = first.currency;
  let amount = first.saleAmount - first.commissionAmount;
  for (const entry of rest) {
    if (entry.currency !== currency) {
      throw new EntifixBuildError(
        `vendor ${vendorId} has entries in ${currency} and ${entry.currency} in one run`,
      );
    }
    amount += entry.saleAmount - entry.commissionAmount;
  }
  return { amount, currency };
};
