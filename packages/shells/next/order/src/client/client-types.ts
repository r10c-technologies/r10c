import type {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@entifix/business';
import type { Context } from 'effect/Context';

/** The repositories the order pages read through, one per entity. */
export interface OrderAdapters {
  productOrderRest: Context<EntityRepositoryTag>;
  configurationStore: Context<ConfigurationRepositoryTag>;
}
