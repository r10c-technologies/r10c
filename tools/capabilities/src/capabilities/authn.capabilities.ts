import type { Capability } from '../types.js';

/**
 * Identity and sessions. The three self-service verbs are done from the account
 * pages, which `ACCOUNT_DESTINATIONS` serves without a workspace address, so
 * they name no screen; the two administrative ones live on the users master.
 */
export const authnCapabilities: readonly Capability[] = [
  {
    id: 'authn:user-identity:revoke-sessions',
    oda: 'TMFC020',
    entities: ['authn:user-identity', 'authn:user-device'],
    permissions: ['authn:user-identity:revoke-sessions'],
    screens: ['master:user-identity'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'authn:user-identity:update-aspects',
    oda: 'TMFC020',
    entities: ['authn:user-identity'],
    permissions: ['authn:user-identity:update-aspects'],
    screens: ['master:user-identity'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'authn:user-identity:sign-out-others',
    oda: 'TMFC020',
    entities: ['authn:user-identity', 'authn:user-device'],
    permissions: ['authn:user-identity:sign-out-others'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'authn:user-identity:switch-organization',
    oda: 'TMFC020',
    entities: ['authn:user-identity'],
    permissions: ['authn:user-identity:switch-organization'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: 'authn:user-device:sign-out-session',
    oda: 'TMFC020',
    entities: ['authn:user-device'],
    permissions: ['authn:user-device:sign-out-session'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
];
