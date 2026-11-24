import type { Capability } from '../types.js';

const SETTLEMENT = 'settlement-management';

/**
 * A vendor's terms and their statement (ADR 0057): the agreement that prices
 * a sale's commission, the ledger lines a sale and its reversal write, the run
 * that settles them and the payout each run computes. Paying the payout out is
 * not built, and says so.
 */
export const settlementManagementCapabilities: readonly Capability[] = [
  {
    id: `${SETTLEMENT}:agreement:read`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:agreement`],
    permissions: [`${SETTLEMENT}:agreement:read`],
    screens: ['master:agreement'],
    status: 'implemented',
    verticals: 'all',
  },
  // Writing terms is an operator act: no role is granted it, so an admin
  // cannot set their own commission (super-admin's wildcard reaches it).
  {
    id: `${SETTLEMENT}:agreement:write`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:agreement`],
    permissions: [`${SETTLEMENT}:agreement:write`],
    screens: ['master:agreement'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SETTLEMENT}:commission-entry:read`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:commission-entry`, `${SETTLEMENT}:agreement`],
    permissions: [`${SETTLEMENT}:commission-entry:read`],
    screens: ['operation:commission-entry'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SETTLEMENT}:settlement-run:read`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:settlement-run`],
    permissions: [`${SETTLEMENT}:settlement-run:read`],
    screens: ['operation:settlement-run'],
    status: 'implemented',
    verticals: 'all',
  },
  // A run settles every unsettled line into one payout per vendor.
  {
    id: `${SETTLEMENT}:settlement-run:write`,
    oda: 'TMFC039',
    entities: [
      `${SETTLEMENT}:settlement-run`,
      `${SETTLEMENT}:commission-entry`,
      `${SETTLEMENT}:vendor-payout`,
    ],
    permissions: [`${SETTLEMENT}:settlement-run:write`],
    screens: ['operation:settlement-run'],
    status: 'implemented',
    verticals: 'all',
  },
  {
    id: `${SETTLEMENT}:vendor-payout:read`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:vendor-payout`],
    permissions: [`${SETTLEMENT}:vendor-payout:read`],
    screens: ['operation:vendor-payout'],
    status: 'implemented',
    verticals: 'all',
  },
  // Paying a payout out to the vendor's account: nothing computes it into a
  // money movement yet, so nothing resolves (ADR 0080 §5).
  {
    id: `${SETTLEMENT}:vendor-payout:disburse`,
    oda: 'TMFC039',
    entities: [`${SETTLEMENT}:vendor-payout`],
    permissions: [`${SETTLEMENT}:vendor-payout:disburse`],
    screens: ['operation:vendor-payout'],
    status: 'planned',
    verticals: 'all',
  },
];
