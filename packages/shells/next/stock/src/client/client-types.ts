import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import type { Context } from 'effect/Context';

export interface StockAdapters {
  stockItemRest: Context<EntityRepositoryTag>;
  stockMovementRest: Context<EntityRepositoryTag>;
  reservationRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
