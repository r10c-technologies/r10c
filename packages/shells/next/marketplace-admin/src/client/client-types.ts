import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityUseCaseRunner } from '@entifix/core';
import type { Context } from 'effect/Context';

export interface MarketplaceAdminAdapters {
  productCategoryRest: Context<EntityRepositoryTag>;
  productBrandRest: Context<EntityRepositoryTag>;
  productRest: Context<EntityRepositoryTag>;
  productOfferingRest: Context<EntityRepositoryTag>;
  productOfferingPriceRest: Context<EntityRepositoryTag>;
  /** The reference vocabulary's served affordances, through `/api/marketplace`. */
  referenceMetadata: EntityMetadataSource;
  /** The catalog service's served affordances, through `/api/admin`. */
  catalogMetadata: EntityMetadataSource;
  /** Each entity's verbs, posted to the path its service derives from the key. */
  productBrandUseCases: EntityUseCaseRunner;
  productCategoryUseCases: EntityUseCaseRunner;
  productOfferingUseCases: EntityUseCaseRunner;
}
