import { Product } from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityLoadRequestTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixError, EntityPage } from '@r10c/entifix-ts-core';
import type { Context } from 'effect/Context';
import type { Effect } from 'effect/Effect';

export interface ProductTableProps {
  uc: Effect<
    EntityPage<Product>,
    EntifixError,
    | EntityLoadRequestTag
    | EntityRepositoryTag
    | ConfigurationRepositoryTag
    | EntityLinkResolverTag
  >;
  ctx: Context<
    EntityRepositoryTag | ConfigurationRepositoryTag | EntityLinkResolverTag
  >;
}
