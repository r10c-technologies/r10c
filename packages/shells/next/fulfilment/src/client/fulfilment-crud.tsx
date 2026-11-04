'use client';

import type { EntityCrud } from '@entifix/next-shell';
import { makeEntityCrud } from '@entifix/next-shell';
import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

import {
  SHIPPING_ORDER_SURFACE,
  SHIPPING_ORDER_WORKLIST,
} from '../fulfilment-surfaces';
import { useFulfilmentAdapters } from './fulfilment-context';

export const shippingOrderCrud: EntityCrud<ShippingOrder> = makeEntityCrud(
  ShippingOrder,
  {
    useAdapters: useFulfilmentAdapters,
    basePath: SHIPPING_ORDER_SURFACE.basePath,
    catalogKey: SHIPPING_ORDER_SURFACE.entityKey,
    repository: 'shippingOrderRest',
    // The list opens on the shipments awaiting dispatch — checked against the
    // entity's `filterable` allowlist when this module loads.
    initialFiltering: SHIPPING_ORDER_WORKLIST,
    // `id` is the store's; `flowId` names the checkout that opened the
    // shipment, which means nothing to the person shipping it.
    hiddenFields: ['id', 'flowId'],
    // ⚠️ Both, or the verbs render nowhere: `EntityForm` draws a declared verb
    // only when it has a handler, and a handler with no metadata source has
    // nothing to draw.
    metadata: 'metadata',
    useCases: 'shippingOrderUseCases',
  },
);

/** Every generated fulfilment screen, for the host's workspace registry. */
export const FULFILMENT_CRUDS = [shippingOrderCrud] as const;

export const ShippingOrderListClientPage = shippingOrderCrud.ListPage;
export const ShippingOrderSingleViewClientPage =
  shippingOrderCrud.SingleViewPage;
