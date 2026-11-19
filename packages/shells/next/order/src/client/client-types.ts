import type { EntityRepositoryTag } from '@entifix/business';
import type { EntityMetadataSource, EntityUseCaseRunner } from '@entifix/core';
import type { Context } from 'effect/Context';

/** One payment-link provider a seller may name (ADR 0081 §10). */
export interface PaymentLinkProviderOption {
  readonly key: string;
  readonly name: string;
  readonly hosts: readonly string[];
}

/** How a payment-link write went: done, or refused under an `errors` code. */
export type PaymentLinkOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string };

/**
 * A payment-link order's two staff verbs and the provider dictionary, through
 * the host's same-origin proxy. Ports rather than the use-case runner, because
 * both verbs carry a body the runner has no way to send.
 */
export interface PaymentLinkPort {
  readonly providers: () => Promise<readonly PaymentLinkProviderOption[]>;
  readonly setLink: (
    orderId: string,
    body: {
      readonly url: string;
      readonly providerKey: string;
      readonly providerName?: string;
    },
  ) => Promise<PaymentLinkOutcome>;
  readonly confirm: (
    orderId: string,
    body: { readonly reference: string },
  ) => Promise<PaymentLinkOutcome>;
}

/** The repositories the order pages read through, one per entity. */
export interface OrderAdapters {
  productOrderRest: Context<EntityRepositoryTag>;
  /** The served affordance document, through the host's same-origin proxy. */
  metadata: EntityMetadataSource;
  /** The order's verbs, posted to the paths the service derives from each key. */
  productOrderUseCases: EntityUseCaseRunner;
  /** A payment-link order's link and confirmation (ADR 0081). */
  paymentLink: PaymentLinkPort;
}
