import { describe, expect, it } from 'vitest';

import { InvalidBody } from './invalid-body.js';

describe('InvalidBody', () => {
  it('is an invalid request, saying what was refused', () => {
    expect(new InvalidBody({ reason: 'no quantity' })).toMatchObject({
      _tag: 'InvalidBody',
      code: 'invalidBody',
      category: 'invalid',
      message: 'no quantity',
    });
  });
});
