import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixError, EntityId, EntityPage } from '@r10c/entifix-ts-core';
import type { Context } from 'effect/Context';
import type { Effect } from 'effect/Effect';

export interface ProductTableProps {
  /** Link builder for a row's record. */
  hrefFor?: (id: EntityId) => string;
  /** Link to the create form. */
  newHref?: string;
  uc: Effect<
    EntityPage<ProductSpecification>,
    EntifixError,
    EntityLoadRequestTag | EntityRepositoryTag | ConfigurationRepositoryTag
  >;
  ctx: Context<EntityRepositoryTag | ConfigurationRepositoryTag>;
}
