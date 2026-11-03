import { defineCatalog, flowCommit } from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import { flowParticipants, participantDialKey } from './participant-dials.js';

describe('the participants a flow calls', () => {
  it('names each service a registered fragment calls, once, and never the commit point', () => {
    expect(flowParticipants()).toEqual([
      'fulfilment-service',
      'order-service',
      'payment-service',
      'stock-service',
    ]);
    expect(flowParticipants(defineCatalog([flowCommit]))).toEqual([]);
  });

  it('keys a dial under its participant', () => {
    expect(participantDialKey('stock-service', 'windowSize')).toBe(
      'stock-service.windowSize',
    );
  });
});
