import type { SliceDeclaration } from '../types.js';

/**
 * Identity, party and access. The one slice with a declared multi-domain store:
 * a `UserIdentity`, the `Individual` behind it and the `Membership` granting it
 * a role are written in the same breath at sign-in and provisioning, and pulling
 * them apart is a data migration, not a refactor.
 */
export const authSlice: SliceDeclaration = {
  name: 'auth',
  status: 'active',
  domains: ['authn', 'party-management', 'access-management'],
  stores: [
    {
      name: 'auth',
      plane: 'control',
      hosts: ['authn', 'party-management', 'access-management'],
      partitioning: 'single',
      truth: 'system-of-record',
      bindingReason:
        'Identity, party and access records are written together at sign-in and ' +
        'at provisioning; separating them needs a data migration. Accepted ' +
        'deliberately — an Organization is what makes a tenant handle derivable, ' +
        'so it cannot itself live behind one.',
    },
    {
      name: 'session',
      plane: 'control',
      // Session and one-time-token records are not `@entity()` classes — they
      // are written through `SessionStore`/`OneTimeTokenStore` ports over Redis.
      // A store with no hosted domain is legitimate; a domain with no store is
      // what the first invariant rules out.
      hosts: [],
      partitioning: 'single',
      truth: 'system-of-record',
    },
  ],
  deployments: ['auth-service'],
  coDeployedWith: [],
  exposedAPIs: [
    'POST /api/auth/oidc/start',
    'POST /api/auth/oidc/callback',
    'POST /api/auth/refresh',
    'POST /api/auth/logout',
    'POST /api/auth/backchannel-logout',
    'POST /api/auth/provider-events',
    'GET /api/user-identity',
    'GET /api/user-device',
  ],
  dependantAPIs: ['GET /api/config/:service'],
  publishedEvents: [],
  subscriptions: [],
};
