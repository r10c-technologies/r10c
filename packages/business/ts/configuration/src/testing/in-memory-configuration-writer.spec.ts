import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Configuration } from '../entities/configuration/index.js';
import { describeConfigurationWriterContract } from './configuration-writer.contract.js';
import { makeInMemoryConfigurationWriter } from './in-memory-configuration-writer.js';

describeConfigurationWriterContract('the in-memory writer', stored =>
  stored === undefined
    ? makeInMemoryConfigurationWriter()
    : makeInMemoryConfigurationWriter(stored),
);

describe('the in-memory writer beyond the contract', () => {
  it('saves a row with no value as a row with no value', async () => {
    const saved = await Effect.runPromise(
      makeInMemoryConfigurationWriter().save(new Configuration(), {
        userId: 'u-1',
        subject: 'ada@example.com',
      }),
    );

    expect(saved.value).toBeUndefined();
  });
});
