import { Context } from 'effect';
import {
  EntityRepositoryTag,
  ConfigurationRepositoryTag,
} from '@r10c/entifix-ts-business';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  ConfigurationStoreRestClient,
} from '@r10c/entifix-ts-rest-client';
import { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import type { MarketplaceAdminAdapters } from '../client-types';

const restOptions: BuildEntityRestOptions = {
  uriConfig: {
    key: 'marketplace-admin-api-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

const productCategoryRest = Context.make(EntityRepositoryTag, {
  get: buildEntityRestAdapterGet(ProductCategory, restOptions),
  load: buildEntityRestAdapterLoad(ProductCategory, restOptions),
  save: buildEntityRestAdapterSave(ProductCategory, restOptions),
  delete: buildEntityRestAdapterDelete(ProductCategory, restOptions),
});

const configStore = new ConfigurationStoreRestClient();

const configurationStore = Context.make(
  ConfigurationRepositoryTag,
  configStore
);

export function createClientAdapters(): MarketplaceAdminAdapters {
  return {
    productCategoryRest,
    configurationStore,
  };
}
