import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { SagaCompensated, SagaStranded } from './saga-failures.js';

describe('how a flow can end badly', () => {
  it('is a compensated conflict, or a stranded internal fault', () => {
    const named = new SagaCompensated({
      sagaId: 's-1',
      refusedStep: 'reserve',
    });
    const stranded = new SagaStranded({ sagaId: 's-1' });

    expect([named, stranded].every(isFailure)).toBe(true);
    expect([named.code, named.category]).toEqual([
      'sagaCompensated',
      'conflict',
    ]);
    expect([stranded.code, stranded.category]).toEqual([
      'sagaStranded',
      'internal',
    ]);
    expect(named.message).toContain("'reserve'");
    expect(stranded.message).toContain('s-1');
  });
});
