import { entityTopic, type PushTopic } from '@entifix/react-integration';

/**
 * What the fulfilment screens are pushed about (ADR 0072): every move of a
 * shipment this member's organization ships. A dispatch, a delivery, a refusal
 * and a return each announce `shipping-order.*`, so the worklist drops a row
 * the moment it leaves `awaiting-dispatch` — whoever moved it.
 */
export const FULFILMENT_PUSH_TOPICS: readonly PushTopic[] = [
  entityTopic('shipping-order'),
];
