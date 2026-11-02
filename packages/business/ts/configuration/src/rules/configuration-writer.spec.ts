import { describe, expect, it } from 'vitest';

import { ConfigurationWriteRefused } from './configuration-writer.js';

describe('ConfigurationWriteRefused', () => {
  it('is an invalid request, carrying the code a client translates', () => {
    expect(new ConfigurationWriteRefused()).toMatchObject({
      _tag: 'ConfigurationWriteRefused',
      code: 'secretRequiresValue',
      category: 'invalid',
      family: 'business',
      message: 'clearing the secret flag requires a new value',
    });
  });
});
