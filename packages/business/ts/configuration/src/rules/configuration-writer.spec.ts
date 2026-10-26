import { describe, expect, it } from 'vitest';

import { ConfigurationWriteRefused } from './configuration-writer.js';

describe('ConfigurationWriteRefused', () => {
  it('carries the code a client translates', () => {
    expect(new ConfigurationWriteRefused('secretRequiresValue')).toMatchObject({
      _tag: 'ConfigurationWriteRefused',
      code: 'secretRequiresValue',
    });
  });
});
