import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import type { EntityMetadataSource } from '@entifix/core';
import type { Context } from 'effect/Context';

/** The repositories the order pages read through, one per entity. */
export interface OrderAdapters {
  productOrderRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
}
