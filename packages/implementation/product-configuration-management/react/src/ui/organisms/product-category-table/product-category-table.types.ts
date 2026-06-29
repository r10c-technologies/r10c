import { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixError,EntityPage } from '@r10c/entifix-ts-core';
import type { Context } from 'effect/Context';
import type { Effect } from 'effect/Effect';

export interface ProductCategoryTableProps {
  uc: Effect<
    EntityPage<ProductCategory>,
    EntifixError,
    EntityLoadRequestTag | EntityRepositoryTag | ConfigurationRepositoryTag
  >;
  ctx: Context<EntityRepositoryTag | ConfigurationRepositoryTag>;
}
