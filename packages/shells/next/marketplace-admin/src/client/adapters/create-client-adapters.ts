import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
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

import type { MarketplaceAdminAdapters } from '../client-types';

const restOptionsFor = (domainKey: string): BuildEntityRestOptions => ({
  uriConfig: {
    key: `${domainKey}.[entity]`,
    group: 'uri',
    extractionMode: 'compose',
  },
});

/**
 * The two backends this shell reads, and which store each one owns.
 *
 * They were one until ADR 0022. `ProductSpecification` is tenant-plane and
 * marketplace-admin-service writes it; `ProductBrand` and `ProductCategory` are
 * the platform-plane vocabulary a marketplace has to *merge*, so they moved to
 * `catalog-reference` in marketplace-service. Pointing both at one domain key is
 * how the brand and category pages ended up requesting routes that no longer
 * existed — the host rewrites each key to its own same-origin proxy.
 */
const CATALOG_SERVICE = restOptionsFor('marketplace-admin-service-domain');
const REFERENCE_SERVICE = restOptionsFor('marketplace-service-domain');

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}. Each page merges only the entity context
 * it needs, so the single tag never collides at the point of use. Link
 * resolution is composed per page from these same adapters — see
 * `createEntityLinkResolver`.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  restOptions: BuildEntityRestOptions,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, restOptions),
    load: buildEntityRestAdapterLoad(entityConstructor, restOptions),
    save: buildEntityRestAdapterSave(entityConstructor, restOptions),
    delete: buildEntityRestAdapterDelete(entityConstructor, restOptions),
  });
}

const configStore = new ConfigurationClientRestClient();
const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  configStore,
);

const productCategoryRest = createRestRepositoryContext(
  ProductCategory,
  REFERENCE_SERVICE,
);
const productBrandRest = createRestRepositoryContext(
  ProductBrand,
  REFERENCE_SERVICE,
);
const productRest = createRestRepositoryContext(
  ProductSpecification,
  CATALOG_SERVICE,
);

export function createClientAdapters(): MarketplaceAdminAdapters {
  return {
    productCategoryRest,
    productBrandRest,
    productRest,
    configurationStore,
  };
}
