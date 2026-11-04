'use client';

import { buildFlowStatusReader } from '@entifix/rest';

import {
  OrderStatusIsland,
  type OrderStatusIslandProps,
} from './order-status-island';

/** The browser's flow-status read: `GET` the status link, `404` as not yet. */
const readStatus = buildFlowStatusReader();

/**
 * The order-status island with the browser's own flow-status reader — the one
 * thing an RSC cannot hand a client component, since it is a function.
 */
export function OrderStatusFlow(
  props: Omit<OrderStatusIslandProps, 'readStatus'>,
) {
  return <OrderStatusIsland {...props} readStatus={readStatus} />;
}
