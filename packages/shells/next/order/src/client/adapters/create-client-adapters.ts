import { ProductOrder } from '@r10c/business-ts-order-management';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@r10c/entifix-ts-rest-client';
import { Context } from 'effect';

import type { OrderAdapters } from '../client-types';

/**
 * order-service, reached through the host's same-origin `/api/order` proxy.
 *
 * The address is composed from a configuration key rather than written here: the
 * app rewrites the domain to its proxy path before the browser sees it, so a
 * literal would be the one place still holding the real port.
 */
const ORDER_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'order-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}.
 *
 * ⚠️ `save` and `delete` are built although **neither has a route a browser can
 * reach**: order-service's writes take a crossing token and no session, and the
 * host's proxy forwards `GET` only. The adapter set is the transport, not the
 * permission — what withholds Save is the *served* descriptor, which reports the
 * caller's real affordances. Omitting the adapters instead would move that
 * decision into the browser, where it would be a second answer to a question the
 * service already answers ([ADR 0026](../../../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, ORDER_SERVICE),
    load: buildEntityRestAdapterLoad(entityConstructor, ORDER_SERVICE),
    save: buildEntityRestAdapterSave(entityConstructor, ORDER_SERVICE),
    delete: buildEntityRestAdapterDelete(entityConstructor, ORDER_SERVICE),
  });
}

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient(),
);

const productOrderRest = createRestRepositoryContext(ProductOrder);

export function createClientAdapters(): OrderAdapters {
  return { productOrderRest, configurationStore };
}
