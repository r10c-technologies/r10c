import type { SliceDeclaration } from '../types.js';

/**
 * What reaches a browser, and where a flow stands
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)):
 * the push stream every tab opens through the edge, and the `flow-status`
 * projection a pending write catches up from.
 *
 * Like `transaction` it claims no domain, because a business verb here would
 * put a domain name in a permission namespace nothing is provisioned for.
 *
 * ⚠️ **Every push subscription is a `broadcast`.** Each replica holds different
 * connections, so each must see every message; one missed while a replica was
 * down is not redelivered, and the browser's `resync` on reopen is what catches
 * it up. Each has a push projection in `@r10c/shells-effect-realtime`, which
 * `slices.spec.ts` checks, and each event's schema requires `meta.audience`,
 * because an event with no audience reaches nobody.
 */
export const realtimeSlice: SliceDeclaration = {
  name: 'realtime',
  status: 'active',
  domains: [],
  stores: [
    {
      name: 'flow-status',
      plane: 'platform',
      hosts: [],
      partitioning: 'single',
      truth: 'projection-of:workflow',
    },
  ],
  deployments: ['realtime-service'],
  coDeployedWith: [],
  exposedAPIs: [
    // The one stream per tab: topics and flow capabilities in the URL, no
    // control route, so any replica can serve any reopen.
    'GET /api/realtime/stream',
    // Where a flow stands, from the flow-status projection: answered to the
    // flow's organizations and parties, or to a capability by digest, and 404
    // to anyone else exactly as to a flow not yet projected.
    'GET /api/realtime/flow{,/:id}',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscriptions: [
    ...[
      'order.placed',
      'order.cancelled',
      'catalog.published',
      'catalog.unpublished',
      'stock-item.changed',
      'shipping-order.dispatched',
      'shipping-order.delivered',
      'shipping-order.refused',
      'shipping-order.returned',
      'flow.completed',
      'flow.failed',
    ].map(event => ({
      event,
      mode: 'broadcast' as const,
      maxAttempts: 5,
      dedupe: 'natural' as const,
      dedupeReason:
        'a push is a notification, not a write: a redelivered snapshot is ' +
        'version-guarded in the browser cache, a redelivered hint re-reads ' +
        'what is already current, and a flow settles once per flowId',
    })),
    // The projection is written once, whichever replica receives the message,
    // and claimed in the same unit: a write must not happen per replica.
    {
      event: 'flow.*',
      mode: 'work' as const,
      maxAttempts: 5,
      dedupe: 'inbox' as const,
    },
  ],
};
