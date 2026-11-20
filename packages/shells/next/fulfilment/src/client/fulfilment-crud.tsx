'use client';

import type { EntityCrud } from '@entifix/next-shell';
import { makeEntityCrud } from '@entifix/next-shell';
import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

import {
  SHIPPING_ORDER_SURFACE,
  SHIPPING_ORDER_WORKLIST,
} from '../fulfilment-surfaces';
import { BuyerChatRegion } from './buyer-chat-region';
import { useFulfilmentAdapters } from './fulfilment-context';
import { ShippingGuideRegion } from './shipping-guide-region';

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
    // The guide a parcel leaves with: a verb with a body, which the header's
    // buttons cannot send (ADR 0081 §11).
    regions: shipment => [
      <ShippingGuideRegion key="guide" shipment={shipment} />,
      // A chat with the buyer, prefilled with where the parcel stands (#671).
      <BuyerChatRegion key="chat" shipment={shipment} />,
    ],
  },
);

/** Every generated fulfilment screen, for the host's workspace registry. */
export const FULFILMENT_CRUDS = [shippingOrderCrud] as const;

export const ShippingOrderListClientPage = shippingOrderCrud.ListPage;
export const ShippingOrderSingleViewClientPage =
  shippingOrderCrud.SingleViewPage;
