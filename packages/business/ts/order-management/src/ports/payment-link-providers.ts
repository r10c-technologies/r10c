import { Context } from 'effect';

import type { PaymentLinkProvider } from '../values/payment-link';

/**
 * The payment-link providers a seller may name, from config-service's
 * `order-service / paymentLinkProvider / <key>` rows — an open dictionary of
 * public facts, seeded with `other` alone (ADR 0081 §10).
 */
export class PaymentLinkProvidersTag extends Context.Service<
  PaymentLinkProvidersTag,
  readonly PaymentLinkProvider[]
>()('PaymentLinkProvidersTag') {}
