import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect/Context';

export interface MarketplaceAdminAdapters {
  productCategoryRest: Context<EntityRepositoryTag>;
  productBrandRest: Context<EntityRepositoryTag>;
  productRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
