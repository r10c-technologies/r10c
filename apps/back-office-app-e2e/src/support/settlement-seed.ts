/**
 * The demo vendor's commercial terms and one period's statement.
 *
 * The agreement is deliberately the same row settlement-service seeds
 * (`apps/settlement-service/src/settlement-temp-data.ts`), so a journey naming
 * the 8% default and the 0% counter reads the same story in either profile.
 *
 * Copied rather than imported: an e2e project reaching into another app's source
 * would couple two runtimes together, and this is fixture data — if the two ever
 * diverge the shared journeys fail, which is the signal we want.
 *
 * ⚠️ **The ledger and the payout are fixtures with no sale behind them**, which
 * the service's own seed deliberately refuses to write. That is the right split:
 * the service must not invent ledger rows nothing paid for, and a browser
 * journey has to be able to open a statement without ringing up a sale through
 * three other services first. The arithmetic those numbers come from is asserted
 * where it lives, in `commission.spec.ts`.
 */
export const agreementSeed = [
  {
    id: 'agreement-e2e-organization',
    vendorId: 'e2e-organization',
    commissionBasisPoints: 800,
    channelCommissionBasisPoints: { counter: 0 },
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  },
];

export const commissionEntrySeed = [
  {
    id: 'commission-entry-1',
    orderId: 'order-1',
    vendorId: 'e2e-organization',
    saleAmount: 2500,
    commissionAmount: 200,
    currency: 'GTQ',
    occurredAt: '2026-03-04T10:00:00.000Z',
    runId: 'settlement-run-1',
  },
];

export const settlementRunSeed = [
  {
    id: 'settlement-run-1',
    periodStart: '2026-03-01T00:00:00.000Z',
    periodEnd: '2026-03-31T23:59:59.000Z',
    status: 'calculated',
  },
];

export const vendorPayoutSeed = [
  {
    id: 'vendor-payout-1',
    runId: 'settlement-run-1',
    vendorId: 'e2e-organization',
    amount: 2300,
    currency: 'GTQ',
  },
];
