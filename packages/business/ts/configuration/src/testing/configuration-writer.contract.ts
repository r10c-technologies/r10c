import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Configuration } from '../entities/configuration';
import {
  type ConfigurationWriter,
  ConfigurationWriteRefused,
} from '../rules/configuration-writer';

/** The one row a subject may be made holding. */
export interface StoredConfiguration {
  readonly id: string;
  readonly service: string;
  readonly groupName: string;
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
}

/** A stored credential: what every refusal and every blanking is about. */
export const CONTRACT_SECRET: StoredConfiguration = {
  id: 'cfg-1',
  service: 'payment-service',
  groupName: 'mongo',
  key: 'uri',
  value: 'mongodb://user:secret@host',
  isSecret: true,
};

const ACTOR = { userId: 'user-1', subject: 'ada@example.com' };

const row = (fields: Partial<Configuration>) =>
  Object.assign(new Configuration(), fields);

/**
 * What every {@link ConfigurationWriter} must guarantee, one write at a time:
 * - a saved row is stamped with who saved it;
 * - a secret is never answered back;
 * - a stored secret cannot be made plain without a new value, because that
 *   would publish the old credential as a plain row (`secretRequiresValue`);
 * - deleting answers whether there was anything to delete.
 *
 * `make(stored)` returns a subject holding at most that one row. The SQL
 * driver fake scripts statements rather than holding rows, so a sequence of
 * writes reading each other back is not something this suite can ask of it.
 */
export const describeConfigurationWriterContract = (
  name: string,
  make: (
    stored?: StoredConfiguration,
  ) => ConfigurationWriter | Promise<ConfigurationWriter>,
) => {
  describe(`${name} honours the ConfigurationWriter contract`, () => {
    const save = async (
      incoming: Configuration,
      stored?: StoredConfiguration,
    ) =>
      Effect.runPromise(
        Effect.result((await make(stored)).save(incoming, ACTOR)),
      );

    it('saves a plain row as given, stamped with who saved it', async () => {
      const saved = await save(
        row({ service: 'payment-service', key: 'db', value: 'payment' }),
      );

      expect(saved).toMatchObject({
        success: { value: 'payment', updatedBy: 'ada@example.com' },
      });
    });

    it('never answers a secret back, new or kept', async () => {
      const created = await save(
        row({ key: 'token', value: 'swordfish', isSecret: true }),
      );
      const kept = await save(
        row({ ...CONTRACT_SECRET, value: '' }),
        CONTRACT_SECRET,
      );

      expect(created).toMatchObject({ success: { value: undefined } });
      expect(kept).toMatchObject({ success: { value: undefined } });
    });

    it('refuses to make a stored secret plain without a new value', async () => {
      const refused = await save(
        row({ id: CONTRACT_SECRET.id, isSecret: false }),
        CONTRACT_SECRET,
      );
      const replaced = await save(
        row({ id: CONTRACT_SECRET.id, isSecret: false, value: 'public' }),
        CONTRACT_SECRET,
      );

      expect(refused).toMatchObject({
        failure: new ConfigurationWriteRefused('secretRequiresValue'),
      });
      expect(replaced).toMatchObject({ success: { value: 'public' } });
    });

    it('deletes a stored row, and answers false for one that is not there', async () => {
      const held = await make(CONTRACT_SECRET);
      const empty = await make();

      expect(
        await Effect.runPromise(held.delete(CONTRACT_SECRET.id, ACTOR)),
      ).toBe(true);
      expect(await Effect.runPromise(empty.delete('cfg-404', ACTOR))).toBe(
        false,
      );
    });
  });
};
