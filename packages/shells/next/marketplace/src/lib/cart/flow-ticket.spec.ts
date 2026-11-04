import { describe, expect, it } from 'vitest';

import { heldCapabilities, holdCapability } from './flow-capabilities.js';
import { parseFlowTicket, serializeFlowTicket } from './flow-ticket.js';

const ticket = {
  flowId: 'f-1',
  capability: 'cap',
  cancelNonce: 'nonce',
  idempotencyKey: 'key',
};

describe('the flow ticket', () => {
  it('round-trips, and reads anything short of four filled strings as none', () => {
    expect(parseFlowTicket(serializeFlowTicket(ticket))).toEqual(ticket);
    expect(parseFlowTicket(undefined)).toBeUndefined();
    expect(parseFlowTicket('not json')).toBeUndefined();
    expect(parseFlowTicket('7')).toBeUndefined();
    expect(parseFlowTicket('null')).toBeUndefined();
    expect(
      parseFlowTicket(JSON.stringify({ ...ticket, capability: '' })),
    ).toBeUndefined();
  });
});

describe('held capabilities', () => {
  it('holds a capability while a page waits, and lets it go', () => {
    const release = holdCapability('cap-1');
    holdCapability('cap-2')();

    expect(heldCapabilities()).toEqual(['cap-1']);
    release();
    expect(heldCapabilities()).toEqual([]);
  });
});
