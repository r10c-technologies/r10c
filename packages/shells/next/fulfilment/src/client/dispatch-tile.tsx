'use client';

import { LocaleLink, useEntityTotal } from '@entifix/next-shell';
import { SummaryTile, useTranslateKey } from '@entifix/react-controls';
import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

import {
  SHIPPING_ORDER_SURFACE,
  SHIPPING_ORDER_WORKLIST,
} from '../fulfilment-surfaces';
import { useFulfilmentAdapters } from './fulfilment-context';

/**
 * The vendor home's dispatch tile (#563, ADR 0077): how many shipments wait to
 * be handed to a courier, one activation from the worklist that opens on
 * exactly those.
 *
 * It counts with the worklist's own filter through this shell's own adapter,
 * so the number and the list it leads to cannot disagree, and a pushed
 * `shipping-order.*` refreshes it like the list.
 */
export function DispatchTile() {
  const translateKey = useTranslateKey();
  const { shippingOrderRest } = useFulfilmentAdapters();
  const { state, total, retry } = useEntityTotal({
    entity: ShippingOrder,
    ctx: shippingOrderRest,
    filtering: SHIPPING_ORDER_WORKLIST,
  });

  return (
    <SummaryTile
      label={translateKey('r10c:fulfilment.home.awaitingDispatch')}
      href={SHIPPING_ORDER_SURFACE.basePath}
      count={total}
      state={state}
      onRetry={retry}
      // A client-side navigation, with the locale put on the href.
      renderLink={({ href, className, children }) => (
        <LocaleLink href={href} className={className}>
          {children}
        </LocaleLink>
      )}
    />
  );
}
