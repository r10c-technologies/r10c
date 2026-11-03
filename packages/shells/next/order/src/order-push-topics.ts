import { entityTopic, type PushTopic } from '@entifix/react-integration';

/**
 * What the order screens are pushed about (ADR 0072): every change to an order
 * this member's organization is on. The realtime slice sends the record itself
 * to a member who may read orders and a hint to anyone else, so a list and a
 * detail stay current without polling.
 */
export const ORDER_PUSH_TOPICS: readonly PushTopic[] = [
  entityTopic('product-order'),
];
