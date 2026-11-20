'use client';

import { Card, Stack, Text, useT } from '@entifix/react-controls';
import { whatsappChatUrl } from '@r10c/business-ts-order-contracts';
import type { ShippingOrder } from '@r10c/business-ts-shipping-order-management';

/** Which prefilled message the chat opens on, by where the parcel stands. */
const stepOf = (status: string) =>
  status === 'dispatched'
    ? 'dispatched'
    : status === 'delivered'
      ? 'delivered'
      : 'preparing';

/**
 * A WhatsApp chat with the buyer, prefilled with the order and where its
 * parcel stands — and, once it left, the tracking number (#671). Built from the
 * phone the buyer gave for the delivery; a shipment whose address the
 * retention sweep removed has none, and offers no chat.
 */
export function BuyerChatRegion({
  shipment,
}: {
  readonly shipment: ShippingOrder;
}) {
  const t = useT('r10c');
  const phone = shipment.destination[0]?.phone;
  const chat = whatsappChatUrl(
    phone,
    t(`fulfilment.whatsapp.text.${stepOf(shipment.status)}`, {
      number: shipment.orderNumber,
      tracking: shipment.trackingNumber ?? '',
    }),
  );
  if (chat === undefined) return null;
  return (
    <Card>
      <Stack gap="2xs" data-testid="buyer-chat-region">
        <Text weight="semibold">{t('fulfilment.whatsapp.heading')}</Text>
        <a
          href={chat}
          target="_blank"
          rel="noreferrer noopener"
          className="touch-target underline"
          data-testid="buyer-chat-link"
        >
          {t('fulfilment.whatsapp.label')}
        </a>
      </Stack>
    </Card>
  );
}
