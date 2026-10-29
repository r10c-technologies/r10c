import { defineEntityApi } from '@entifix/business';
import { entityKey, JsonBody } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  Agreement,
  CommissionEntry,
  MixedCurrencies,
  settlementNarrowing,
  SettlementRun,
  SettlementRunStoreTag,
  validateAgreement,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { Effect } from 'effect';

/**
 * A vendor's terms. Writing one is granted to **no** role: an `admin` who
 * could write it could set their own commission to zero, so it is an operator
 * act reached through `super-admin`'s wildcard. Its rates are checked as they
 * are saved — a channel nobody has a rate for would otherwise fall through to
 * the default and bill a rate nobody agreed.
 *
 * ⚠️ **Every read is narrowed to the caller** (ADR 0053): an operator reads
 * across vendors, a vendor their own terms, ledger lines and payouts, and
 * anybody else an empty page — never a `403`, which would say the record
 * exists.
 */
export const agreementApi = defineEntityApi(
  Agreement,
  entityKey(Agreement, 'agreement'),
  {
    verbs: ['list', 'get', 'create', 'update'],
    guard: { kind: 'permission' },
    narrowing: settlementNarrowing<Agreement>(),
    prepare: validateAgreement,
    errors: [InvalidBody],
  },
);

/** The commission ledger: folded from the bus, authored by nobody. */
export const commissionEntryApi = defineEntityApi(
  CommissionEntry,
  entityKey(CommissionEntry, 'commission-entry'),
  {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
    narrowing: settlementNarrowing<CommissionEntry>(),
  },
);

/** What each vendor is owed per run — the gross less the cut, possibly negative. */
export const vendorPayoutApi = defineEntityApi(
  VendorPayout,
  entityKey(VendorPayout, 'vendor-payout'),
  {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
    narrowing: settlementNarrowing<VendorPayout>(),
  },
);

/**
 * The runs, and `POST /api/settlement-run` — settle now, rather than wait for
 * the sweep. The same pass the sweep runs, so the two cannot disagree.
 */
export const settlementRunApi = defineEntityApi(
  SettlementRun,
  entityKey(SettlementRun, 'settlement-run'),
  {
    verbs: ['list', 'get', 'create'],
    guard: { kind: 'permission' },
    override: {
      create: {
        // The pass reads only the ledger: nothing in a body could steer it.
        payload: JsonBody,
        errors: [MixedCurrencies],
        handler: () =>
          Effect.gen(function* () {
            const runs = yield* SettlementRunStoreTag;
            return {
              meta: { type: 'settlementRun' },
              data: yield* runs.settleOnce(),
            };
          }),
      },
    },
  },
);
