import { Configuration } from '@r10c/business-ts-configuration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@r10c/entifix-ts-rest-client';
import { Context } from 'effect';

import type { SystemManagementAdapters } from '../client-types';

/**
 * The configuration CRUD lives on config-service, so its own uri key is what the
 * adapters compose against — **not** the host app's domain service.
 *
 * This shell is `scope:shared`, so it cannot reach into
 * `shells-next-marketplace-admin` for an adapter factory even though one exists
 * there; that boundary is exactly what lets a second host mount these pages. The
 * host rewrites `config-service-domain` to a same-origin proxy path before the
 * browser sees it, so nothing here knows a proxy is involved.
 */
const restOptions: BuildEntityRestOptions = {
  uriConfig: {
    key: 'config-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

const configurationRest = Context.make(EntityRepositoryTag, {
  get: buildEntityRestAdapterGet(Configuration, restOptions),
  load: buildEntityRestAdapterLoad(Configuration, restOptions),
  save: buildEntityRestAdapterSave(Configuration, restOptions),
  delete: buildEntityRestAdapterDelete(Configuration, restOptions),
});

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient(),
);

export function createClientAdapters(): SystemManagementAdapters {
  return { configurationRest, configurationStore };
}
