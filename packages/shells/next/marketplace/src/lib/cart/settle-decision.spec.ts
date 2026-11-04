import { describe, expect, it } from 'vitest';

import { settleDecision } from './settle-decision.js';

describe('settleDecision', () => {
  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    ['compensated', 'failed'],
    ['interrupted', 'failed'],
    ['running', 'pending'],
  ])('reads a flow %s as %s', (state, decided) => {
    expect(settleDecision({ data: { state } })).toBe(decided);
  });

  it('reads no answer — a flow not projected yet — as pending', () => {
    expect(settleDecision(undefined)).toBe('pending');
  });
});
