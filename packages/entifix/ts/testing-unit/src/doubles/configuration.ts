import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import {
  type ConfigurationClient,
  ConfigurationClientInMemory,
  type ConfigurationPlain,
} from '@r10c/entifix-ts-core';
import { Layer } from 'effect';

/**
 * The group the REST adapters read their entity URIs from when
 * `BuildEntityRestOptions.uriConfig.group` is left unset.
 */
export const DEFAULT_URI_GROUP = 'restUri';

/**
 * A {@link ConfigurationClient} over a plain `{ group: [{ key, value }] }`
 * literal. This is a stub, not a fake: it answers reads and nothing else.
 *
 * Backed by core's own `ConfigurationClientInMemory`, so the parsing rules under
 * test are the production ones rather than a second implementation that could
 * drift.
 */
export const makeStubConfigurationClient = (
  plain: ConfigurationPlain = {},
): ConfigurationClient => new ConfigurationClientInMemory(plain);

/**
 * The common case for REST adapter specs: every entity resolves under one base
 * URL, keyed the way `buildEntityBaseUrl` looks them up.
 *
 * `entities` maps an entity `key` to its endpoint; passing `{ product: '…' }`
 * satisfies a `uriConfig.key` of `'service.[entity]'`.
 */
export const makeStubUriConfigurationClient = (
  entities: Record<string, string>,
  { keyTemplate = '[entity]', group = DEFAULT_URI_GROUP } = {},
): ConfigurationClient =>
  makeStubConfigurationClient({
    [group]: Object.entries(entities).map(([entity, uri]) => ({
      key: keyTemplate.replace('[entity]', entity),
      value: uri,
    })),
  });

/** Provides {@link ConfigurationRepositoryTag} from a plain configuration. */
export const stubConfigurationLayer = (plain: ConfigurationPlain = {}) =>
  Layer.succeed(ConfigurationRepositoryTag, makeStubConfigurationClient(plain));

/** Provides {@link ConfigurationRepositoryTag} from an entity-to-URI mapping. */
export const stubUriConfigurationLayer = (
  entities: Record<string, string>,
  options?: { keyTemplate?: string; group?: string },
) =>
  Layer.succeed(
    ConfigurationRepositoryTag,
    makeStubUriConfigurationClient(entities, options),
  );
