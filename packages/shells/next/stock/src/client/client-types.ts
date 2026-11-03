import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityWriter } from '@entifix/core';
import type { Context } from 'effect/Context';

export interface StockAdapters {
  stockItemWriter: EntityWriter;
  stockMovementWriter: EntityWriter;
  stockItemRest: Context<EntityRepositoryTag>;
  stockMovementRest: Context<EntityRepositoryTag>;
  reservationRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
}
