import { DeviceModel } from '@r10c/business-ts-catalog-reference';
import { describe, expect, it } from 'vitest';

import { fitNames, readFitIds, toggleFit } from './device-model-fit-picker.js';

describe('readFitIds', () => {
  it('splits the draft’s comma form and drops blanks', () => {
    expect(readFitIds(' dm-1, ,dm-2 ')).toEqual(['dm-1', 'dm-2']);
    expect(readFitIds('')).toEqual([]);
  });
});

describe('toggleFit', () => {
  it('clears every model when universal is ticked', () => {
    expect(toggleFit(['dm-1', 'dm-2'], 'universal', true)).toEqual([
      'universal',
    ]);
  });

  it('clears universal when a model is ticked', () => {
    expect(toggleFit(['universal'], 'dm-1', true)).toEqual(['dm-1']);
  });

  it('removes what is cleared', () => {
    expect(toggleFit(['dm-1', 'dm-2'], 'dm-1', false)).toEqual(['dm-2']);
  });
});

describe('fitNames', () => {
  const model = new DeviceModel('Galaxy A15');
  model.id = 'dm-1';

  it('reads ids as names, universal as its label, and an unknown id as itself', () => {
    expect(
      fitNames(['dm-1', 'universal', 'dm-9'], [model], 'Universal'),
    ).toBe('Galaxy A15, Universal, dm-9');
  });
});
