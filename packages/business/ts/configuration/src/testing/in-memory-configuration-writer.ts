import { Effect } from 'effect';

import type { Configuration } from '../entities/configuration';
import {
  type ConfigurationWriter,
  ConfigurationWriteRefused,
} from '../rules/configuration-writer';
import { decideSecretWrite } from '../rules/secret-write';
import type { StoredConfiguration } from './configuration-writer.contract';

/**
 * A {@link ConfigurationWriter} held in memory, for the specs of whatever
 * consumes the port. It runs `describeConfigurationWriterContract`, so it
 * decides a secret write by the same rule and blanks what it answers.
 */
export const makeInMemoryConfigurationWriter = (
  ...stored: readonly StoredConfiguration[]
): ConfigurationWriter => {
  // Only what a later write's decision reads: whether a row is secret, and
  // the value a blank incoming one keeps.
  const rows = new Map(
    stored.map(one => [one.id, { isSecret: one.isSecret, value: one.value }]),
  );

  return {
    save: (incoming: Configuration, actor) =>
      Effect.suspend(() => {
        const id = String(incoming.id ?? globalThis.crypto.randomUUID());
        const decision = decideSecretWrite(rows.get(id), incoming);
        if (decision._tag === 'refuse') {
          return Effect.fail(new ConfigurationWriteRefused(decision.code));
        }
        const isSecret = incoming.isSecret === true;
        rows.set(id, { isSecret, value: decision.value ?? '' });
        incoming.id = id;
        incoming.value = isSecret ? undefined : decision.value;
        incoming.updatedAt = new Date();
        incoming.updatedBy = actor.subject;
        return Effect.succeed(incoming);
      }),
    delete: id => Effect.sync(() => rows.delete(String(id))),
  };
};
