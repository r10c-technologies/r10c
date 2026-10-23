import type {
  EntityRepositoryTag,
} from '@entifix/business';
import type { EntityMetadataSource } from '@entifix/core';
import type { Context } from 'effect/Context';

export interface SettlementAdapters {
  agreementRest: Context<EntityRepositoryTag>;
  commissionEntryRest: Context<EntityRepositoryTag>;
  settlementRunRest: Context<EntityRepositoryTag>;
  vendorPayoutRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
}
