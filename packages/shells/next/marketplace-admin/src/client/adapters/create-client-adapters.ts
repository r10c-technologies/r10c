import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
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
  ConfigurationStoreRestClient,
} from '@r10c/entifix-ts-rest-client';
import { Context } from 'effect';

import type { MarketplaceAdminAdapters } from '../client-types';

const restOptions: BuildEntityRestOptions = {
  uriConfig: {
    key: 'marketplace-admin-api-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}. Each page merges only the entity context
 * it needs, so the single tag never collides at the point of use. Link
 * resolution is composed per page from these same adapters — see
 * `createEntityLinkResolver`.
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, restOptions),
    load: buildEntityRestAdapterLoad(entityConstructor, restOptions),
    save: buildEntityRestAdapterSave(entityConstructor, restOptions),
    delete: buildEntityRestAdapterDelete(entityConstructor, restOptions),
  });
}

const configStore = new ConfigurationStoreRestClient();
const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  configStore,
);

const productCategoryRest = createRestRepositoryContext(ProductCategory);
const productBrandRest = createRestRepositoryContext(ProductBrand);
const productRest = createRestRepositoryContext(Product);

export function createClientAdapters(): MarketplaceAdminAdapters {
  return {
    productCategoryRest,
    productBrandRest,
    productRest,
    configurationStore,
  };
}
