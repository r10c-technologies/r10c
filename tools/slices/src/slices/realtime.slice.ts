import type { SliceDeclaration } from '../types.js';

/**
 * What reaches a browser, and where a flow stands
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)):
 * the push stream every tab opens through the edge, and the `flow-status`
 * projection a pending write catches up from.
 *
 * **Planned.** It owns its store now so a boundary error shows up when the
 * projection lands rather than when the service does. Like `transaction` it
 * claims no domain, because a business verb here would put a domain name in a
 * permission namespace nothing is provisioned for. Promoted to `active`, with
 * `realtime-service` on `:3191`, by the commit that writes the store (#476,
 * #477).
 */
export const realtimeSlice: SliceDeclaration = {
  name: 'realtime',
  status: 'planned',
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
  deployments: [],
  coDeployedWith: [],
  exposedAPIs: [],
  dependantAPIs: [],
  publishedEvents: [],
  subscriptions: [],
};
