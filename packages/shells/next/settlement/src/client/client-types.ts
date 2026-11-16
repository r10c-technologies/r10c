import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityWriter } from '@entifix/core';
import type { VendorBalance } from '@r10c/business-ts-settlement-management';
import type { Context } from 'effect/Context';

export interface SettlementAdapters {
  agreementWriter: EntityWriter;
  agreementRest: Context<EntityRepositoryTag>;
  commissionEntryRest: Context<EntityRepositoryTag>;
  settlementRunRest: Context<EntityRepositoryTag>;
  vendorPayoutRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
  /**
   * What the next run will pay the caller (#562), narrowed by the service:
   * a vendor reads their own, anybody else the empty balance. Rejects when
   * the service could not answer.
   */
  vendorBalance: () => Promise<VendorBalance>;
}
