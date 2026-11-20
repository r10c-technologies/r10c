import type { Capability } from '../types.js';

/**
 * The organization as a party. Its fiscal identity and whether it takes
 * payment links are stated by its own
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
  {
    id: 'party-management:organization:set-payment-link-acceptance',
    oda: 'TMFC028',
    entities: ['party-management:organization'],
    permissions: ['party-management:organization:set-payment-link-acceptance'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
  // #671: the number a receipt's WhatsApp link writes to.
  {
    id: 'party-management:organization:set-whatsapp-number',
    oda: 'TMFC028',
    entities: ['party-management:organization'],
    permissions: ['party-management:organization:set-whatsapp-number'],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
];
