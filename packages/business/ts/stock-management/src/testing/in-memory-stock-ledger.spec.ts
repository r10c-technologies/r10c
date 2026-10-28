import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Reservation } from '../entities/reservation/index.js';
import { StockMovement } from '../entities/stock-movement/index.js';
import { makeInMemoryStockLedger } from './in-memory-stock-ledger.js';
import { describeStockLedgerContract } from './stock-ledger.contract.js';

describeStockLedgerContract('the in-memory ledger', makeInMemoryStockLedger);

describe('the in-memory ledger beyond the contract', () => {
  it('never expires a hold with no deadline, nor one already ended', async () => {
    const ledger = makeInMemoryStockLedger();
    const receipt = Object.assign(new StockMovement('o-1', 2, 'receipt'), {
      id: 'm-1',
    });
    const open = Object.assign(new Reservation('o-1', 1), { id: 'r-open' });
    const ended = Object.assign(new Reservation('o-1', 1), {
      id: 'r-ended',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const released = await Effect.runPromise(
      Effect.gen(function* () {
        yield* ledger.record('org-a', receipt);
        yield* ledger.take('org-a', open, undefined);
        yield* ledger.take('org-a', ended, undefined);
        yield* ledger.end('org-a', 'r-ended', 'released');
        return yield* ledger.releaseExpired();
      }),
    );

    expect(released).toEqual({ released: 0, failed: [] });
  });
});
