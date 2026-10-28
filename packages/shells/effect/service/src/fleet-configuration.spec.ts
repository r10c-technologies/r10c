import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  configurationRows,
  fleetConfigurationOf,
} from './fleet-configuration.js';

describe('fleetConfigurationOf', () => {
  it('keeps the rows as served, and reads them by group and key', async () => {
    const plain = { order: configurationRows({ cancelWindowSeconds: 60 }) };
    const configuration = fleetConfigurationOf(plain);

    expect(configuration.plain).toBe(plain);
    expect(
      await Effect.runPromise(
        configuration.store.in('order').getNumber('cancelWindowSeconds'),
      ),
    ).toBe(60);
  });
});
