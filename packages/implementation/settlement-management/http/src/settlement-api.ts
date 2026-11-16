import { permissionForEntity } from '@entifix/authz';
import { defineEntityApi, RequestPrincipalTag } from '@entifix/business';
import { defineEndpoint, entityKey, implement, JsonBody } from '@entifix/core';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  Agreement,
  CommissionEntry,
  MixedCurrencies,
  settlementNarrowing,
  SettlementRun,
  SettlementRunStoreTag,
  validateAgreement,
  vendorBalance,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { Effect, Schema } from 'effect';

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

/**
 * `GET /api/vendor-balance` — what the next settlement run will pay the caller
 * (#562): `{ amount, currency?, unsettledEntries }`, `currency` absent when
 * nothing is owed.
 *
 * Guarded by the ledger's own read permission, because it is a fold of the
 * ledger lines that permission already shows, and narrowed the way every
 * settlement read is: a vendor gets their own, anybody else the empty answer
 * (ADR 0053) — never a `403`, which would say there was something to hide.
 */
const vendorBalanceEndpoint = defineEndpoint({
  name: 'vendor-balance',
  method: 'GET',
  path: '/api/vendor-balance',
  success: Schema.Struct({
    amount: Schema.Number,
    currency: Schema.optionalKey(Schema.String),
    unsettledEntries: Schema.Number,
  }),
  errors: [MixedCurrencies],
  guard: {
    kind: 'permission',
    permission: permissionForEntity(CommissionEntry, 'read'),
  },
});

export const vendorBalanceEndpoints = [
  implement(vendorBalanceEndpoint, () =>
    Effect.gen(function* () {
      return yield* vendorBalance(yield* RequestPrincipalTag);
    }),
  ),
] as const;
