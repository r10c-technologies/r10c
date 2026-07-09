import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixError, EntityPage } from '@r10c/entifix-ts-core';
import type { Context } from 'effect/Context';
import type { Effect } from 'effect/Effect';

export interface ProductBrandTableProps {
  uc: Effect<
    EntityPage<ProductBrand>,
    EntifixError,
    EntityLoadRequestTag | EntityRepositoryTag | ConfigurationRepositoryTag
  >;
  ctx: Context<EntityRepositoryTag | ConfigurationRepositoryTag>;
}
