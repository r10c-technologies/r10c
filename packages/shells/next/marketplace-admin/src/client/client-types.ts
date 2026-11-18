import type { EntityRepositoryTag } from '@entifix/business';
import type {
  EntityMetadataSource,
  EntityUseCaseRunner,
  EntityWriter,
} from '@entifix/core';
import type { Context } from 'effect/Context';

export interface MarketplaceAdminAdapters {
  deviceModelWriter: EntityWriter;
  productBrandWriter: EntityWriter;
  productCategoryWriter: EntityWriter;
  productWriter: EntityWriter;
  productOfferingWriter: EntityWriter;
  productOfferingPriceWriter: EntityWriter;
  productCategoryRest: Context<EntityRepositoryTag>;
  deviceModelRest: Context<EntityRepositoryTag>;
  productBrandRest: Context<EntityRepositoryTag>;
  productRest: Context<EntityRepositoryTag>;
  productOfferingRest: Context<EntityRepositoryTag>;
  productOfferingPriceRest: Context<EntityRepositoryTag>;
  /** The sellers' names, from marketplace-service's projection. Read-only. */
  publishedVendorRest: Context<EntityRepositoryTag>;
  /** The reference vocabulary's served affordances, through `/api/marketplace`. */
  referenceMetadata: EntityMetadataSource;
  /** The catalog service's served affordances, through `/api/admin`. */
  catalogMetadata: EntityMetadataSource;
  /** Each entity's verbs, posted to the path its service derives from the key. */
  deviceModelUseCases: EntityUseCaseRunner;
  productBrandUseCases: EntityUseCaseRunner;
  productCategoryUseCases: EntityUseCaseRunner;
  productOfferingUseCases: EntityUseCaseRunner;
}
