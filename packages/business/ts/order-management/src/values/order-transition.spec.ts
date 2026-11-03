import { describe, expect, it } from 'vitest';

import { OrderStatuses } from './order-status.js';
import {
  isLegalOrderTransition,
  orderStatusAfter,
  OrderTransitions,
  statusesBefore,
} from './order-transition.js';

/** The whole lifecycle, stated once more by hand: every pair not here is illegal. */
const LEGAL: Record<string, string> = {
  'pending confirm': 'confirmed',
  'paid confirm': 'confirmed',
  'confirmed mark-dispatched': 'dispatched',
  'dispatched close-fulfilled': 'fulfilled',
  'dispatched close-cancelled': 'cancelled',
  'paid claim-cancel': 'cancelling',
  'confirmed claim-cancel': 'cancelling',
  'cancelling settle-cancel': 'cancelled',
};

describe('orderStatusAfter', () => {
  const pairs = OrderStatuses.flatMap(status =>
    OrderTransitions.map(transition => [status, transition] as const),
  );

  it.each(pairs)('%s × %s', (status, transition) => {
    expect(orderStatusAfter(status, transition)).toBe(
      LEGAL[`${status} ${transition}`],
    );
    expect(isLegalOrderTransition(status, transition)).toBe(
      LEGAL[`${status} ${transition}`] !== undefined,
    );
  });

  it('refuses a second claim on a record already claimed — the refusal is the lock', () => {
    expect(orderStatusAfter('cancelling', 'claim-cancel')).toBeUndefined();
  });

  it('never cancels a dispatched order by claim: only a refusal or a return closes it', () => {
    expect(orderStatusAfter('dispatched', 'claim-cancel')).toBeUndefined();
  });
});

describe('statusesBefore', () => {
  it('names the statuses a move’s conditional write matches', () => {
    expect(statusesBefore('confirm')).toEqual(['pending', 'paid']);
    expect(statusesBefore('claim-cancel')).toEqual(['paid', 'confirmed']);
  });
});
