import type { Context } from 'effect/Context';
import type {
  EntityRepositoryTag,
  ConfigurationRepositoryTag,
} from '@r10c/entifix-ts-business';

export interface MarketplaceAdminAdapters {
  productCategoryRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
