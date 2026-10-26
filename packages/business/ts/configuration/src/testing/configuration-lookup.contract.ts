import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  ConfigurationLookup,
  StoredConfigurationRow,
} from '../rules/configuration-lookup';

/** One service's stored rows, as a subject is made holding them. */
export interface ServiceRow extends StoredConfigurationRow {
  readonly service: string;
}

/** The service every lookup in the suite asks about. */
export const CONTRACT_SERVICE = 'payment-service';

/** What every subject is made holding: two rows for the asked service, one for another. */
export const CONTRACT_ROWS: readonly ServiceRow[] = [
  {
    service: CONTRACT_SERVICE,
    groupName: 'mongo',
    key: 'uri',
    value: 'mongodb://user:secret@host',
    isSecret: true,
  },
  {
    service: CONTRACT_SERVICE,
    groupName: 'mongo',
    key: 'database',
    value: 'payment',
    isSecret: false,
  },
  {
    service: 'order-service',
    groupName: 'mongo',
    key: 'database',
    value: 'order',
    isSecret: false,
  },
];

/**
 * What every {@link ConfigurationLookup} must guarantee: a service is served
 * its own rows and no other's, grouped, **with real values** and the secret
 * flag on exactly the secrets; and the store's stats count every row and name
 * every service once, in order.
 *
 * `make(rows)` returns a subject holding `rows`. The SQL driver fake cannot
 * filter by a statement's parameters, so a subject is asked only about
 * {@link CONTRACT_SERVICE}, and may answer for it alone.
 */
export const describeConfigurationLookupContract = (
  name: string,
  make: (
    rows: readonly ServiceRow[],
  ) => ConfigurationLookup | Promise<ConfigurationLookup>,
) => {
  describe(`${name} honours the ConfigurationLookup contract`, () => {
    it("serves a service its own rows, grouped, with real values and the secret flag", async () => {
      const lookup = await make(CONTRACT_ROWS);

      expect(
        await Effect.runPromise(lookup.forService(CONTRACT_SERVICE)),
      ).toEqual({
        mongo: [
          {
            key: 'uri',
            value: 'mongodb://user:secret@host',
            isSecret: true,
          },
          { key: 'database', value: 'payment' },
        ],
      });
    });

    it('serves a service with no rows nothing', async () => {
      const lookup = await make([]);

      expect(
        await Effect.runPromise(lookup.forService(CONTRACT_SERVICE)),
      ).toEqual({});
    });

    it('counts every row, and names every service once, in order', async () => {
      const lookup = await make(CONTRACT_ROWS);

      expect(await Effect.runPromise(lookup.stats())).toEqual({
        rowCount: 3,
        services: ['order-service', 'payment-service'],
      });
    });
  });
};
