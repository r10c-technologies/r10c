import type { Capability } from '../types.js';

const PAYMENT = 'payment-management';

/**
 * Payments are taken inside flows — a capture is the checkout's pivot, a
 * refund the cancellation's (ADR 0054, ADR 0058) — so the register cites the
 * read only. It has no screen of its own: a payment is shown on its order.
 */
export const paymentManagementCapabilities: readonly Capability[] = [
  {
    id: `${PAYMENT}:payment:read`,
    oda: 'TMFC029',
    entities: [`${PAYMENT}:payment`, `${PAYMENT}:payment-allocation`],
    permissions: [`${PAYMENT}:payment:read`],
    screens: [],
    status: 'implemented',
    verticals: 'all',
  },
];
