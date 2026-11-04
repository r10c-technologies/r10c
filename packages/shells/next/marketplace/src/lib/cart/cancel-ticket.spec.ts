import { describe, expect, it } from 'vitest';

import { parseCancelTicket, serializeCancelTicket } from './cancel-ticket';

const TICKET = { flowId: 'f-1', capability: 'cap', orderId: 'o-1' };

describe('the cancel ticket', () => {
  it('reads back what it wrote', () => {
    expect(parseCancelTicket(serializeCancelTicket(TICKET))).toEqual(TICKET);
  });

  it('reads anything but three filled strings as no ticket', () => {
    expect(parseCancelTicket(undefined)).toBeUndefined();
    expect(parseCancelTicket('not json')).toBeUndefined();
    expect(parseCancelTicket('null')).toBeUndefined();
    expect(parseCancelTicket('7')).toBeUndefined();
    expect(
      parseCancelTicket(JSON.stringify({ ...TICKET, orderId: '' })),
    ).toBeUndefined();
  });
});
