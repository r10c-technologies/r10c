import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import type { EntityMetadataSource } from '@entifix/core';
import type { Context } from 'effect/Context';

export interface StockAdapters {
  stockItemRest: Context<EntityRepositoryTag>;
  stockMovementRest: Context<EntityRepositoryTag>;
  reservationRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
}
