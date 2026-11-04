import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityUseCaseRunner } from '@entifix/core';
import type { Context } from 'effect/Context';

/** The transports the fulfilment pages read and act through. */
export interface FulfilmentAdapters {
  shippingOrderRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
  /** The shipment's verbs, posted to the paths the service derives from each key. */
  shippingOrderUseCases: EntityUseCaseRunner;
}
