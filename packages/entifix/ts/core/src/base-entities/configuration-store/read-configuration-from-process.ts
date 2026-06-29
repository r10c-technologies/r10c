import { ConfigurationItem, ConfigurationPlain } from './types';

/**
 * Groups a flat record of `GROUP__KEY=value` entries into `ConfigurationPlain`.
 *
 * The input is expected to be already scoped to a single service (the
 * `SERVICE__` prefix removed by the caller). Each entry's name is split on the
 * first `__` into a group and a key (the key may itself contain `__`). Malformed
 * entries without a group/key pair are skipped.
 */
export const readConfigurationFromProcess = (
  keys: Record<string, string>
): ConfigurationPlain => {
  const config: ConfigurationPlain = {};

  for (const [name, value] of Object.entries(keys)) {
    const [group, ...rest] = name.split('__');
    if (!group || rest.length === 0) {
      continue;
    }

    const key = rest.join('__');
    const item: ConfigurationItem = { key, value };
    (config[group] ??= []).push(item);
  }

  return config;
};
