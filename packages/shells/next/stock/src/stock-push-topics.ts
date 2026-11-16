import { entityTopic, type PushTopic } from '@entifix/react-integration';

/**
 * What the stock screens are pushed about (ADR 0072): every counter move on a
 * position this member's organization holds. Each movement, hold and
 * restoration announces `stock-item.changed` (#481), and the realtime slice
 * pushes it to the vendor's own tabs, so the stock list and the home's
 * out-of-stock tile (#563) move without a reload.
 */
export const STOCK_PUSH_TOPICS: readonly PushTopic[] = [
  entityTopic('stock-item'),
];
