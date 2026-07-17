import { ProductBrand } from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixError, EntityId, EntityPage } from '@r10c/entifix-ts-core';
import type { Context } from 'effect/Context';
import type { Effect } from 'effect/Effect';

export interface ProductBrandTableProps {
  uc: Effect<
    EntityPage<ProductBrand>,
    EntifixError,
    EntityLoadRequestTag | EntityRepositoryTag | ConfigurationRepositoryTag
  >;
  ctx: Context<EntityRepositoryTag | ConfigurationRepositoryTag>;
  /** Link builder for a row's record; forwarded to the generic Table. */
  hrefFor?: (id: EntityId) => string;
  /** Link to the create form. */
  newHref?: string;
}
