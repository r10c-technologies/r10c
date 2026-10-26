import { describe, expect, it } from 'vitest';

import { toConfigurationPlain } from './configuration-lookup.js';

describe('toConfigurationPlain', () => {
  it('groups rows by group, and flags only the secrets', () => {
    expect(
      toConfigurationPlain([
        { groupName: 'mongo', key: 'uri', value: 'm://x', isSecret: true },
        { groupName: 'mongo', key: 'db', value: 'p', isSecret: false },
        { groupName: 'amqp', key: 'url', value: 'a://y', isSecret: false },
      ]),
    ).toEqual({
      mongo: [
        { key: 'uri', value: 'm://x', isSecret: true },
        { key: 'db', value: 'p' },
      ],
      amqp: [{ key: 'url', value: 'a://y' }],
    });
  });
});
