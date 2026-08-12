import { describe, expect, it } from 'vitest';

import { readConfigurationFromProcess } from './read-configuration-from-process.js';

describe('readConfigurationFromProcess', () => {
  it('groups entries by the segment before the first double underscore', () => {
    expect(
      readConfigurationFromProcess({
        MONGO__URI: 'mongodb://host',
        MONGO__DB: 'catalog',
        REDIS__URI: 'redis://host',
      }),
    ).toEqual({
      MONGO: [
        { key: 'URI', value: 'mongodb://host' },
        { key: 'DB', value: 'catalog' },
      ],
      REDIS: [{ key: 'URI', value: 'redis://host' }],
    });
  });

  // Only the *first* separator delimits the group, so a key is free to contain
  // more of them — splitting greedily would shred nested keys.
  it('keeps further separators inside the key', () => {
    expect(readConfigurationFromProcess({ MONGO__POOL__MAX: '10' })).toEqual({
      MONGO: [{ key: 'POOL__MAX', value: '10' }],
    });
  });

  it.each([
    ['no separator at all', { MONGO: 'x' }],
    ['an empty group', { __URI: 'x' }],
  ])('skips a malformed entry with %s', (_label, input) => {
    expect(readConfigurationFromProcess(input)).toEqual({});
  });

  it('accepts an empty key after the separator', () => {
    expect(readConfigurationFromProcess({ MONGO__: 'x' })).toEqual({
      MONGO: [{ key: '', value: 'x' }],
    });
  });

  it('returns an empty configuration for no entries', () => {
    expect(readConfigurationFromProcess({})).toEqual({});
  });
});
