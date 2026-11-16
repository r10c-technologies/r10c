import { type RequestPrincipal, RequestPrincipalTag } from '@entifix/business';
import {
  SettlementLedgerTag,
  SettlementRunStoreTag,
} from '@r10c/business-ts-settlement-management';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  agreementApi,
  commissionEntryApi,
  settlementRunApi,
  vendorBalanceEndpoints,
  vendorPayoutApi,
} from './settlement-api.js';

const [balance] = vendorBalanceEndpoints;

describe('the settlement declarations', () => {
  it('narrow every read to the caller, and only agreements are authored', () => {
    for (const api of [agreementApi, commissionEntryApi, vendorPayoutApi]) {
      expect(api.options.guard).toEqual({ kind: 'permission' });
      expect(api.options.narrowing.map(rule => rule.variant.name)).toEqual([
        'operator',
        'vendor',
      ]);
    }
    expect(agreementApi.options.verbs).toEqual([
      'list',
      'get',
      'create',
      'update',
    ]);
    expect(commissionEntryApi.options.verbs).toEqual(['list', 'get']);
    expect(vendorPayoutApi.options.verbs).toEqual(['list', 'get']);
  });

  it('settles now through the same pass the sweep runs', async () => {
    const outcome = { kind: 'idle' } as const;

    const answer = await Effect.runPromise(
      settlementRunApi.options.override.create.handler().pipe(
        Effect.provideService(SettlementRunStoreTag, {
          settleOnce: () => Effect.succeed(outcome),
        }),
      ),
    );

    expect(answer).toEqual({ meta: { type: 'settlementRun' }, data: outcome });
  });
});

describe('the vendor balance', () => {
  const askedBy = (principal: Partial<RequestPrincipal>) =>
    Effect.runPromise(
      balance.handler({} as never).pipe(
        Effect.provideService(SettlementLedgerTag, {
          unsettledFor: () =>
            Effect.succeed([
              { saleAmount: 100, commissionAmount: 10, currency: 'GTQ' },
            ]),
        }),
        Effect.provideService(RequestPrincipalTag, {
          subject: 'u-1',
          sessionId: 's-1',
          roles: [],
          attributes: {},
          ...principal,
        } as RequestPrincipal),
      ),
    );

  it('is guarded by the ledger’s read permission', () => {
    expect(balance.descriptor.guard).toEqual({
      kind: 'permission',
      permission: 'settlement-management:commission-entry:read',
    });
  });

  it('answers a vendor their own balance, and anybody else nothing', async () => {
    expect(
      await askedBy({ partyRole: 'vendor', organizationId: 'v-1' }),
    ).toEqual({ amount: 90, currency: 'GTQ', unsettledEntries: 1 });
    expect(await askedBy({ partyRole: 'operator' })).toEqual({
      amount: 0,
      unsettledEntries: 0,
    });
  });
});
