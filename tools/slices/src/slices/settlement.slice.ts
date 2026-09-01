import type { SliceDeclaration } from '../types.js';

/**
 * What the platform owes each vendor, and on what terms.
 *
 * The one commerce slice whose store is **control** plane, and the difference is
 * not an oversight. A plane answers *who may read it*: an `Agreement` is the
 * platform's own record about a vendor — the same character as `Entitlement`,
 * and nothing like a public catalog. ADR 0020 explicitly allows a slice to own
 * stores in more than one plane, so the neighbours being platform plane is no
 * argument for putting this one there.
 *
 * Batch by nature — a settlement run is periodic, long-running, and the exact
 * coarse operation `LockService` is for. That is a different shape from a
 * request-path slice, which is why the ownership is recorded separately even
 * while nothing runs it yet.
 */
export const settlementSlice: SliceDeclaration = {
  name: 'settlement',
  status: 'planned',
  domains: ['settlement-management'],
  stores: [
    {
      name: 'settlement',
      plane: 'control',
      hosts: ['settlement-management'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: [
    'GET|POST|PUT /api/agreement',
    'GET /api/settlement-run',
    'GET /api/vendor-payout',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: ['settlement.run.completed'],
  subscriptions: [{ event: 'payment.captured', mode: 'work', maxAttempts: 5 }],
};
