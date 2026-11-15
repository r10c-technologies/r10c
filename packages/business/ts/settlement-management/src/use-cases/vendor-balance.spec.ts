import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { SettlementLedgerTag } from '../ports/settlement-ports';
import type { PayoutEntry } from '../values/commission';
import { EMPTY_BALANCE, vendorBalance } from './vendor-balance';

const over = (lines: readonly PayoutEntry[]) => {
  const asked: string[] = [];
  const ledger = {
    unsettledFor: (vendorId: string) =>
      Effect.sync(() => {
        asked.push(vendorId);
        return lines;
      }),
  };
  const run = (reader: { partyRole?: string; organizationId?: string }) =>
    Effect.runPromiseExit(
      vendorBalance(reader).pipe(
        Effect.provideService(SettlementLedgerTag, ledger),
      ),
    );
  return { asked, run };
};

const vendor = { partyRole: 'vendor', organizationId: 'v-1' };

describe('vendorBalance', () => {
  it('folds the vendor’s unsettled lines the way a payout does', async () => {
    const { asked, run } = over([
      { saleAmount: 100, commissionAmount: 10, currency: 'GTQ' },
      {
        saleAmount: 50,
        commissionAmount: 5,
        currency: 'GTQ',
        collectedBy: 'vendor',
      },
    ]);

    expect(await run(vendor)).toEqual(
      Exit.succeed({ amount: 85, currency: 'GTQ', unsettledEntries: 2 }),
    );
    expect(asked).toEqual(['v-1']);
  });

  it('answers the empty balance for a vendor owed nothing', async () => {
    expect(await over([]).run(vendor)).toEqual(Exit.succeed(EMPTY_BALANCE));
  });

  it('reads nothing for a caller who is not a vendor with an organization', async () => {
    const { asked, run } = over([
      { saleAmount: 100, commissionAmount: 10, currency: 'GTQ' },
    ]);

    for (const reader of [
      { partyRole: 'operator', organizationId: 'v-1' },
      { partyRole: 'vendor' },
      {},
    ]) {
      expect(await run(reader)).toEqual(Exit.succeed(EMPTY_BALANCE));
    }
    expect(asked).toEqual([]);
  });

  it('refuses lines in two currencies, as the run does', async () => {
    const exit = await over([
      { saleAmount: 100, commissionAmount: 10, currency: 'GTQ' },
      { saleAmount: 100, commissionAmount: 10, currency: 'USD' },
    ]).run(vendor);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain('MixedCurrencies');
  });
});
