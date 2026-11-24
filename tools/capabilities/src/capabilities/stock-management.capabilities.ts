import type { Capability } from '../types.js';

const STOCK = 'stock-management';

/**
 * Stock as a movement ledger (ADR 0010): what a vendor holds, what moved it and
 * what a checkout is holding. Only the entries a guide or the site cites —
 * CRUD is written when something needs to name it (ADR 0080 §2). A hold taken,
 * released or converted, and goods put back, are the checkout and cancellation
 * flows' crossings; the site shows them as routes in the stock lifecycle.
 */
export const stockManagementCapabilities: readonly Capability[] = [
  {
    id: `${STOCK}:stock-item:read`,
    oda: null,
    entities: [`${STOCK}:stock-item`],
    permissions: [`${STOCK}:stock-item:read`],
    screens: ['operation:stock-item'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${STOCK}:stock-movement:read`,
    oda: null,
    entities: [`${STOCK}:stock-movement`, `${STOCK}:stock-item`],
    permissions: [`${STOCK}:stock-movement:read`],
    screens: ['operation:stock-movement'],
    status: 'implemented',
    verticals: 'all',
  },
  // Goods in, goods counted, goods written off: one append-only movement,
  // never a quantity overwritten.
  {
    id: `${STOCK}:stock-movement:write`,
    oda: null,
    entities: [`${STOCK}:stock-movement`, `${STOCK}:stock-item`],
    permissions: [`${STOCK}:stock-movement:write`],
    screens: ['operation:stock-movement'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${STOCK}:reservation:read`,
    oda: null,
    entities: [`${STOCK}:reservation`, `${STOCK}:stock-item`],
    permissions: [`${STOCK}:reservation:read`],
    screens: ['operation:reservation'],
    status: 'implemented',
    verticals: 'all',
  },
];
