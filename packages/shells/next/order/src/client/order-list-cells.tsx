'use client';

import type { EntityCrudListView } from '@entifix/next-shell';
import { useTranslateKey } from '@entifix/react-controls';
import type { ProductOrder } from '@r10c/business-ts-order-management';

/**
 * What an order holds, in one line: its first product, by the name it was
 * sold under (#582), and how many more follow (#556). A vendor working down
 * the day's orders scans this column; a nested list of lines is a read.
 */
export function OrderItemsCell({ order }: { order: ProductOrder }) {
  const translateKey = useTranslateKey();
  const [first, ...rest] = order.items;
  if (first === undefined) return null;
  return rest.length === 0
    ? first.name
    : translateKey('r10c:order.list.itemsMore', {
        name: first.name,
        count: rest.length,
      });
}

/**
 * The order list a vendor reads (#556): the number, the status, what was
 * bought, the total and when. Every other member stays on the record's page.
 *
 * ⚠️ A list view, not `hiddenFields`: those hide a member from the form, and
 * these must stay on it. The buyer, vendor and group ids are always the
 * reader's own organization's or meaningless to them; the fiscal and payment
 * detail is what a record is opened for, not what a row is scanned by.
 */
export const PRODUCT_ORDER_LIST_VIEW: EntityCrudListView = {
  hiddenColumns: [
    'buyerId',
    'vendorId',
    'groupId',
    'channel',
    'paidAt',
    'sellerTaxId',
    'sellerLegalName',
    'sellerTaxRegime',
    'sellerEstablishmentCode',
    'buyerTaxIdType',
    'buyerTaxId',
    'buyerTaxName',
    'netAmount',
    'taxAmount',
    'currency',
    'paymentDueAt',
    'paymentReference',
    'paymentConfirmedBy',
    'paymentConfirmedAt',
    'paymentLinkUrl',
    'paymentLinkProviderKey',
    'paymentLinkProviderName',
    'paymentLinkSetBy',
    'paymentLinkSetAt',
    'cancelCause',
    'courierName',
    'trackingNumber',
    'trackingUrl',
    'dispatchedAt',
    'fulfilledAt',
  ],
};
