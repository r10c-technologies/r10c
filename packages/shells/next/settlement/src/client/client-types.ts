import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect/Context';

export interface SettlementAdapters {
  agreementRest: Context<EntityRepositoryTag>;
  commissionEntryRest: Context<EntityRepositoryTag>;
  settlementRunRest: Context<EntityRepositoryTag>;
  vendorPayoutRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
