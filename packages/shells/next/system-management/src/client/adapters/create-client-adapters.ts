import {
  EntityRepositoryTag,
} from '@entifix/business';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@entifix/rest';
import { Configuration } from '@r10c/business-ts-configuration';
import { Context } from 'effect';

import type { SystemManagementAdapters } from '../client-types';

/**
 * Where every adapter below resolves its URL, bound when each is built — the
 * host's `/api/config`, so the lookup is same-origin and carries the session.
 */
const configuration = new ConfigurationClientRestClient();

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
  configuration,
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

export function createClientAdapters(): SystemManagementAdapters {
  return { configurationRest };
}
