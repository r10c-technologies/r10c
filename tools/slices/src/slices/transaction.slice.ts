import type { SliceDeclaration } from '../types.js';

/**
 * The saga tracker: a passive consumer that folds transaction events into a
 * durable record clients poll after their `202`.
 *
 * It owns a store, so it is a slice. Whether it runs as its own process or is
 * co-deployed into another is a deployment fact, not an ownership one — the
 * `saga` store has exactly one writing slice either way, and moving it is a
 * matter of pointing `deployments` at a different app.
 */
export const transactionSlice: SliceDeclaration = {
  name: 'transaction',
  status: 'active',
  domains: [],
  stores: [
    {
      name: 'saga',
      plane: 'control',
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['marketplace-admin-service'],
  coDeployedWith: ['marketplace-admin'],
  exposedAPIs: ['GET /api/transaction/:id', 'GET /api/transaction/events'],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscriptions: [
    // Work: the fold is an idempotent upsert that wants exactly one replica,
    // and it must not lose an event across its own restart.
    { event: 'transaction.*', mode: 'work', maxAttempts: 5 },
    // Broadcast, and the first in the register: this one feeds the browser
    // connections held by `GET /api/transaction/events`. Every replica holds
    // *different* connections, so a `work` queue would deliver each event to one
    // replica and the clients on the others would silently never learn
    // (ADR 0030 built the mode for this consumer; ADR 0036 is the consumer).
    { event: 'transaction.*', mode: 'broadcast', maxAttempts: 5 },
  ],
};
