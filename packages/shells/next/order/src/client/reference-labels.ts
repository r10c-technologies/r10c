import type { ReferenceLabelRegistration } from '@entifix/business';
import { ProductOrder } from '@r10c/business-ts-order-management';

import { createClientAdapters } from './adapters/create-client-adapters';

/**
 * The orders a reference on another screen points at — a shipment's
 * `orderId` — read through this shell's `/api/order` adapter (entifix 0030).
 *
 * An order has no member a person reads it by until it is numbered (#577), so
 * it declares no `labelMember` and every reference to one reads as entifix's
 * short-id fallback ("Pedido «8a564966»") rather than its whole UUID.
 * Registering it is what makes the fallback apply: an unregistered target
 * has nobody to ask.
 *
 * Exported for the host to list, never for another shell (ADR 0077).
 */
export const ORDER_REFERENCE_LABELS: readonly ReferenceLabelRegistration[] = [
  [ProductOrder, createClientAdapters().productOrderRest],
];
