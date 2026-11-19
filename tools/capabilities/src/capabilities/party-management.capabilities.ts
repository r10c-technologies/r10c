import type { Capability } from '../types.js';

/**
 * The organization as a party. Its fiscal identity is stated by its own
 * `admin` from the back office's organization page, which — like the account
 * pages — is the caller's own record rather than a master, so it names no
 * workspace screen.
 */
export const partyManagementCapabilities: readonly Capability[] = [
  {
    id: 'party-management:organization:set-fiscal-identity',
    oda: 'TMFC028',
    entities: ['party-management:organization'],
    permissions: ['party-management:organization:set-fiscal-identity'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
];
