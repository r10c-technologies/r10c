import type { SliceDeclaration } from '../types.js';

/**
 * Cross-service configuration. The fleet's boot dependency: every other slice
 * resolves its own parameters from here before it can open a connection, which
 * is why this one is never co-deployed into a domain slice — doing so would make
 * every service's boot wait on a domain host.
 */
export const configSlice: SliceDeclaration = {
  name: 'config',
  status: 'active',
  domains: ['config'],
  stores: [
    {
      name: 'configuration',
      plane: 'control',
      hosts: ['config'],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['config-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'GET /api/config/:service',
    'GET|POST|PUT|DELETE /api/configuration',
  ],
  dependantAPIs: [],
  publishedEvents: [],
  subscriptions: [],
};
