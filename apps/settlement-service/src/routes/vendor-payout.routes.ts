import { entityMetadataRoute } from '@entifix/service-shell';
import {
  CommissionEntry,
  VendorPayout,
} from '@r10c/business-ts-settlement-management';
import { HttpRouter } from 'effect/http';

import {
  byIdRoute,
  emptyPageRoute,
  guarded,
  listRoute,
  notFoundRoute,
} from './entity-crud';
import {
  settlementInScope,
  settlementScopeFilter,
  settlementScopeFor,
} from './settlement-scope';

/**
 * What the platform owes, and the ledger the total is a fold of.
 *
 * **Reads only, and no role holds their write.** A `VendorPayout` is computed by
 * a settlement run and a `CommissionEntry` by the fold that prices a captured
 * sale; neither is a thing a person authors, so the served descriptor withholds
 * Save on its own and no screen has to say so
 * ([ADR 0033](../../../../docs/adr/0033-the-screen-taxonomy.md)).
 *
 * Both are scoped to the caller like the agreement beside them: a vendor sees
 * their own statement and nobody else's takings.
 *
 * ⚠️ **`$metadata` before `/:id`** on both, for the routing reason named on the
 * agreement routes.
 */
export const vendorPayoutRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/vendor-payout',
    guarded(VendorPayout, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? emptyPageRoute(VendorPayout)
        : listRoute(VendorPayout, settlementScopeFilter<VendorPayout>(scope));
    }),
  ),
  HttpRouter.route(
    'GET',
    '/api/vendor-payout/$metadata',
    entityMetadataRoute(VendorPayout),
  ),
  HttpRouter.route(
    'GET',
    '/api/vendor-payout/:id',
    guarded(VendorPayout, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? notFoundRoute(VendorPayout)
        : byIdRoute(VendorPayout, payout => settlementInScope(scope, payout));
    }),
  ),
]);

export const commissionEntryRoutes = HttpRouter.addAll([
  HttpRouter.route(
    'GET',
    '/api/commission-entry',
    guarded(CommissionEntry, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? emptyPageRoute(CommissionEntry)
        : listRoute(
            CommissionEntry,
            settlementScopeFilter<CommissionEntry>(scope),
          );
    }),
  ),
  HttpRouter.route(
    'GET',
    '/api/commission-entry/$metadata',
    entityMetadataRoute(CommissionEntry),
  ),
  HttpRouter.route(
    'GET',
    '/api/commission-entry/:id',
    guarded(CommissionEntry, 'read', principal => {
      const scope = settlementScopeFor(principal);
      return scope.kind === 'nothing'
        ? notFoundRoute(CommissionEntry)
        : byIdRoute(CommissionEntry, entry => settlementInScope(scope, entry));
    }),
  ),
]);
