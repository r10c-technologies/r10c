'use client';

import type { EntityCrudListView } from '@entifix/next-shell';
import { Money, useLocale, useTranslateKey } from '@entifix/react-controls';
import type { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

/**
 * What goes in the parcel — "2 × Cog, 1 × Flange" — by the names the lines
 * were sold under (#557). Packing the wrong parcel is the costliest mistake in
 * the back office's daily loop, and a row that says what is in it is how a
 * vendor avoids opening every record to find out.
 */
export function ShipmentContentsCell({
  shipment,
}: {
  shipment: ShippingOrder;
}) {
  const translateKey = useTranslateKey();
  return (
    <>
      {shipment.lines
        .map(line =>
          translateKey('r10c:fulfilment.list.line', {
            quantity: line.quantity,
            name: line.name,
          }),
        )
        .join(', ')}
    </>
  );
}

/**
 * Where the parcel goes: municipality and department (#557). The street stays
 * on the record. Empty once the retention sweep removed the destination
 * (ADR 0076 §4) — the parcel's journey is over by then.
 */
export function ShipmentDestinationCell({
  shipment,
}: {
  shipment: ShippingOrder;
}) {
  const [destination] = shipment.destination;
  if (destination === undefined) return null;
  return (
    <>
      {[destination.municipio, destination.departamento]
        .filter(part => part !== '')
        .join(', ')}
    </>
  );
}

/**
 * What the courier collects, which is only ever something on cash on delivery.
 * A card or link payment is already paid, so its row shows nothing rather than
 * a zero that reads as "collect nothing" on a parcel nobody collects for.
 */
export function AmountDueCell({ shipment }: { shipment: ShippingOrder }) {
  const locale = useLocale();
  if (shipment.paymentMethod !== 'cod') return null;
  return (
    <Money
      amount={shipment.amountDue}
      currency={shipment.currency}
      unit="minor"
      locale={locale}
    />
  );
}

/**
 * The worklist a vendor packs from (#557): the order's number, the status,
 * what goes in the parcel, where it goes, how it is paid and what the courier
 * collects. Every other member stays on the record's page.
 *
 * ⚠️ A list view, not `hiddenFields`: the record still shows them. `orderId`
 * goes because the number names the same order in words a person reads out.
 */
export const SHIPPING_ORDER_LIST_VIEW: EntityCrudListView = {
  hiddenColumns: [
    'orderId',
    'redactedAt',
    'groupId',
    'flowId',
    'taxableBase',
    'taxAmount',
    'taxRegime',
    'currency',
    'deliveredAt',
    'refusedAt',
    'returnedAt',
    'withdrawnAt',
    'courierKey',
    'courierName',
    'trackingNumber',
    'trackingUrl',
    'guideRecordedAt',
  ],
};
