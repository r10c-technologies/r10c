import type { Effect } from 'effect/Effect';
import type { Context } from 'effect/Context';
import { EntityLoadRequestTag } from '@r10c/entifix-ts-business';
import { EntityPage, EntifixError } from '@r10c/entifix-ts-core';
import {
  EntityRepositoryTag,
  ConfigurationRepositoryTag,
} from '@r10c/entifix-ts-business';
import { ProductCategory } from '@r10c/business-ts-product-configuration-management';

export interface ProductCategoryTableProps {
  uc: Effect<
    EntityPage<ProductCategory>,
    EntifixError,
    EntityLoadRequestTag | EntityRepositoryTag | ConfigurationRepositoryTag
  >;
  ctx: Context<EntityRepositoryTag | ConfigurationRepositoryTag>;
}
