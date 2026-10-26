import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import type { Entity, EntityConstructor } from '@entifix/core';
import {
  type EntityReadScope,
  type EntityRouteContext,
  makeEntityRoutes,
  type RequestPrincipal,
  routeFailure,
} from '@entifix/service-shell';
import {
  Agreement,
  CommissionEntry,
  settlementInScope,
  SettlementRun,
  SettlementRunStoreTag,
  settlementScopeFilter,
  settlementScopeFor,
  validateAgreement,
  VendorPayout,
  type VendorScoped,
} from '@r10c/business-ts-settlement-management';
import { Effect, Layer } from 'effect';
import { HttpServerResponse } from 'effect/http';

/** What a host provides for {@link settlementRoutes}. */
export type SettlementRouteServices =
  | EntityRepositoryFactoryTag
  | SettlementRunStoreTag
  | TokenServiceTag
  | PolicyDecisionTag;

/**
 * Every read here narrowed to its caller: an operator reads across vendors, a
 * vendor their own terms, ledger lines and payouts, anybody else nothing.
 */
const vendorScope =
  <T extends Entity & VendorScoped>() =>
  ({ principal }: EntityRouteContext) =>
    Effect.sync((): EntityReadScope<T> => {
      const scope = settlementScopeFor(principal as RequestPrincipal);
      if (scope.kind === 'nothing') return 'none';
      const filter = settlementScopeFilter<T>(scope);
      return filter === undefined
        ? 'all'
        : { filter, includes: (record: T) => settlementInScope(scope, record) };
    });

const scopedReads = <T extends Entity & VendorScoped>(
  entity: EntityConstructor<T>,
) =>
  makeEntityRoutes(entity, {
    verbs: ['list', 'get'],
    guard: { kind: 'permission' },
    scope: vendorScope<T>(),
  });

/**
 * `POST /api/settlement-run` — settle now, rather than wait for the sweep.
 * The same pass the sweep runs, so the two cannot disagree.
 */
const settleNow = () =>
  Effect.gen(function* () {
    const runs = yield* SettlementRunStoreTag;
    return yield* HttpServerResponse.json({
      meta: { type: 'settlementRun' },
      data: yield* runs.settleOnce(),
    });
  }).pipe(Effect.catch(routeFailure));

/**
 * settlement-service's surface. Writing an agreement is granted to **no**
 * role: an `admin` who could write it could set their own commission to zero,
 * so it is an operator act reached through `super-admin`'s wildcard. Its
 * rates are checked as they are saved — a channel nobody has a rate for would
 * otherwise fall through to the default and bill a rate nobody agreed.
 */
export const settlementRoutes = Layer.mergeAll(
  makeEntityRoutes(Agreement, {
    verbs: ['list', 'get', 'create', 'update'],
    guard: { kind: 'permission' },
    scope: vendorScope<Agreement>(),
    prepare: agreement => {
      const invalid = validateAgreement(agreement);
      return invalid === undefined
        ? Effect.succeed(agreement)
        : Effect.fail(invalid);
    },
  }),
  scopedReads(CommissionEntry),
  scopedReads(VendorPayout),
  makeEntityRoutes(SettlementRun, {
    verbs: ['list', 'get', 'create'],
    guard: { kind: 'permission' },
    override: { create: settleNow },
  }),
);
