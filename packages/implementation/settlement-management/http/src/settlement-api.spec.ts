import { SettlementRunStoreTag } from '@r10c/business-ts-settlement-management';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  agreementApi,
  commissionEntryApi,
  settlementRunApi,
  vendorPayoutApi,
} from './settlement-api.js';

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
