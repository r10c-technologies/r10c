import type { StoreFault } from '@entifix/core';
import { Effect } from 'effect';

import type { MixedCurrencies } from '../failures/settlement-failures';
import { SettlementLedgerTag } from '../ports/settlement-ports';
import { payoutFor } from '../values/commission';

/**
 * What the next settlement run will pay one vendor (#562): the gross less the
 * cut over every line no run has claimed yet, in the one currency those lines
 * share. `currency` is absent when there is nothing to pay, since an empty
 * balance has no currency to state.
 */
export interface VendorBalance {
  readonly amount: number;
  readonly currency?: string;
  readonly unsettledEntries: number;
}

/** The answer for a caller with no vendor to read, and for a vendor owed nothing. */
export const EMPTY_BALANCE: VendorBalance = { amount: 0, unsettledEntries: 0 };

/** Who is asking, as the slice shell's verified principal states it. */
export interface BalanceReader {
  readonly partyRole?: string;
  readonly organizationId?: string;
}

/**
 * A vendor's balance, narrowed to the caller the way every settlement read is
 * (ADR 0053): a vendor reads their own, and anybody else — an operator, who
 * acts for no vendor, a buyer, a vendor session with no organization — reads
 * nothing.
 *
 * ⚠️ **The same fold the run applies, never re-derived.** It is `payoutFor`
 * over the lines the next run would claim, so the gross-less-the-cut rule, the
 * `collectedBy: 'vendor'` debit and the single currency cannot drift from what
 * the vendor is then paid. Summing commission entries page by page in a
 * browser would be a second implementation of all three.
 */
export const vendorBalance = (
  reader: BalanceReader,
): Effect.Effect<
  VendorBalance,
  StoreFault | MixedCurrencies,
  SettlementLedgerTag
> =>
  Effect.gen(function* () {
    const vendorId =
      reader.partyRole === 'vendor' ? reader.organizationId : undefined;
    if (vendorId === undefined) return EMPTY_BALANCE;

    const ledger = yield* SettlementLedgerTag;
    const lines = yield* ledger.unsettledFor(vendorId);
    const [first, ...rest] = lines;
    if (first === undefined) return EMPTY_BALANCE;

    const { amount, currency } = yield* payoutFor(vendorId, [first, ...rest]);
    return { amount, currency, unsettledEntries: lines.length };
  });
