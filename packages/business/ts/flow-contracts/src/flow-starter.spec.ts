import { describe, expect, it } from 'vitest';

import { FlowNotStarted } from './flow-starter.js';

describe('FlowNotStarted', () => {
  it('is a declined refusal that names the coordinator’s own code', () => {
    const refused = new FlowNotStarted({ refusal: 'flowRequirementsUnmet' });

    expect([refused.code, refused.category, refused.message]).toEqual([
      'flowNotStarted',
      'declined',
      'the coordinator refused to start: flowRequirementsUnmet',
    ]);
  });
});
