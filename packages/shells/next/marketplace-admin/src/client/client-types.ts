import type {
  EntityRepositoryTag,
} from '@entifix/business';
import type { EntityMetadataSource } from '@entifix/core';
import type { TransactionStatusReader } from '@entifix/transactions';
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
  /** Reads one transaction's record, for settling an optimistic write. */
  transactionStatus: TransactionStatusReader;
}
