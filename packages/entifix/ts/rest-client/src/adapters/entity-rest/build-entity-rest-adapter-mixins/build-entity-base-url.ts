import { ConfigurationStore } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { BuildEntityRestOptions } from '../types';

const DEFAULT_URI_GROUP = 'restUri';

export const buildEntityBaseUrl = (
  configurationStore: ConfigurationStore,
  options: BuildEntityRestOptions,
  entityName: string,
  entityId?: string
) =>
  Effect.gen(function* () {
    const { uriConfig } = options;
    const entityUri = yield* configurationStore
      .in(uriConfig.group ?? DEFAULT_URI_GROUP)
      .getString(
        uriConfig.key.replace('[entity]', entityName),
        uriConfig.extractionMode
      );

    return entityId ? `${entityUri}/${entityId}` : entityUri;
  });
