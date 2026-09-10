import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { SalesChannel } from '@r10c/business-ts-sales-management';
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

import type { SalesAdapters } from '../client-types';

/**
 * The two backends this shell reads, as **symbolic domain keys** rather than
 * addresses.
 *
 * The host rewrites each to its own same-origin proxy path before the browser
 * sees the configuration, which keeps real backend addresses out of the bundle
 * and carries the httpOnly cookie upstream — a cross-origin call would answer
 * `401`.
 *
 * ⚠️ **Two keys, because the till reads a store this slice does not own.** The
 * channels come from sales-service; the offerings a seller picks come from the
 * published projection marketplace-service owns, which is the same record the
 * storefront charges a buyer against. Reading the vendor's *tenant* catalog
 * instead would let a counter sell at a price no buyer was ever shown, and
 * would need a second price-selection rule nobody has written
 * ([ADR 0056](../../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 *
 * ⚠️ Plain REST, deliberately not `create: 'command'`: a channel has no
 * server-assigned member anyone waits for, this service runs no transaction
 * engine and its slice publishes no event, so a `202` would buy a tracker record
 * for nothing.
 */
const SALES_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'sales-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

const MARKETPLACE_SERVICE: BuildEntityRestOptions = {
  uriConfig: {
    key: 'marketplace-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the CRUD adapter set for one entity, backed by REST, under the shared
 * {@link EntityRepositoryTag}. Each page merges only the entity context it
 * needs, so the single tag never collides at the point of use.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  options: BuildEntityRestOptions,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, options),
    load: buildEntityRestAdapterLoad(entityConstructor, options),
    save: buildEntityRestAdapterSave(entityConstructor, options),
    delete: buildEntityRestAdapterDelete(entityConstructor, options),
  });
}

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  new ConfigurationClientRestClient(),
);

const salesChannelRest = createRestRepositoryContext(
  SalesChannel,
  SALES_SERVICE,
);

/**
 * ⚠️ Read-only in practice: marketplace-service serves no write route for the
 * projection, which is written by the publication consumer. The adapter set is
 * the transport rather than the permission, and the served descriptor is what
 * withholds a Save.
 */
const publishedOfferingRest = createRestRepositoryContext(
  PublishedOffering,
  MARKETPLACE_SERVICE,
);

export function createClientAdapters(): SalesAdapters {
  return { salesChannelRest, publishedOfferingRest, configurationStore };
}
