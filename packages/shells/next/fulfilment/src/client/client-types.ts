import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityUseCaseRunner } from '@entifix/core';
import type { Context } from 'effect/Context';

/** One courier a vendor may name, as the dictionary serves it. */
export interface CourierOption {
  readonly key: string;
  readonly name: string;
  readonly trackingUrlTemplate: string;
}

/** How a guide write went: done, or refused under an `errors` code. */
export type GuideOutcome =
  { readonly ok: true } | { readonly ok: false; readonly code: string };

/** What a vendor types when they record a guide. */
export interface GuideBody {
  readonly courierKey: string;
  readonly trackingNumber: string;
  readonly courierName?: string;
  readonly trackingUrl?: string;
}

/**
 * The guide a parcel leaves with, and the courier dictionary it is picked
 * from, through the host's same-origin proxy (ADR 0081 §11). A port rather
 * than the use-case runner, because the verb carries a body the runner has no
 * way to send.
 */
export interface ShippingGuidePort {
  readonly couriers: () => Promise<readonly CourierOption[]>;
  readonly record: (
    shippingOrderId: string,
    body: GuideBody,
  ) => Promise<GuideOutcome>;
}

/** The transports the fulfilment pages read and act through. */
export interface FulfilmentAdapters {
  shippingOrderRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
  /** The shipment's verbs, posted to the paths the service derives from each key. */
  shippingOrderUseCases: EntityUseCaseRunner;
  /** A parcel's guide, recorded before it is dispatched (ADR 0081 §11). */
  guide: ShippingGuidePort;
}
