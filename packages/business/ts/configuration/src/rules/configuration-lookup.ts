import type { ConfigurationPlain, EntifixConnError } from '@entifix/core';
import { Context, type Effect } from 'effect';

/** One stored configuration row, as the lookup reads it. */
export interface StoredConfigurationRow {
  readonly groupName: string;
  readonly key: string;
  readonly value: string;
  readonly isSecret: boolean;
}

/** How many rows the store holds, and for which services. */
export interface ConfigurationStats {
  readonly rowCount: number;
  readonly services: readonly string[];
}

/**
 * What a booting service is served, and what the store says about itself.
 *
 * ⚠️ **This port answers real values, secrets included.** A booting service
 * needs the actual key; `isSecret` rides along so the consumer knows which of
 * them it must never echo out of its own introspection. It is reached only
 * behind the fleet's shared token — the operator-facing CRUD, behind a user's
 * permission, is {@link ConfigurationWriter} and blanks every secret.
 */
export interface ConfigurationLookup {
  readonly forService: (
    service: string,
  ) => Effect.Effect<ConfigurationPlain, EntifixConnError>;
  readonly stats: () => Effect.Effect<ConfigurationStats, EntifixConnError>;
}

export class ConfigurationLookupTag extends Context.Service<
  ConfigurationLookupTag,
  ConfigurationLookup
>()('ConfigurationLookupTag') {}

/**
 * Groups a service's rows into the `ConfigurationPlain` contract, carrying
 * `isSecret` only where it is true.
 */
export const toConfigurationPlain = (
  rows: ReadonlyArray<StoredConfigurationRow>,
): ConfigurationPlain => {
  const plain: ConfigurationPlain = {};
  for (const row of rows) {
    (plain[row.groupName] ??= []).push({
      key: row.key,
      value: row.value,
      ...(row.isSecret ? { isSecret: true } : {}),
    });
  }
  return plain;
};
