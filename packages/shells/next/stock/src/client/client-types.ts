import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import type { Context } from 'effect/Context';

export interface StockAdapters {
  stockItemRest: Context<EntityRepositoryTag>;
  stockMovementRest: Context<EntityRepositoryTag>;
  reservationRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
