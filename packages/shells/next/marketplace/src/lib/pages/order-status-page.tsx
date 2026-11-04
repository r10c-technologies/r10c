import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Button,
  ButtonLink,
  Card,
  Cluster,
  HeadingOne,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import { formatPrice } from '@r10c/utils-react-ui';

import { cancelOrder } from '../cart/cancel-action';
import type { CancelOutcome } from '../cart/cancel-outcome';
import type { CancelTicket } from '../cart/cancel-ticket';
import { readCancelTicket } from '../cart/cancel-ticket-cookie';
import { cancelWindowLabel } from '../cart/cancel-window';
import { checkout } from '../cart/checkout-action';
import { readFlowTicket } from '../cart/flow-ticket-cookie';
import { OrderStatusFlow } from '../cart/order-status-flow';
import { readReceipt } from '../cart/receipt-cookie';
import type { Receipt, ReceiptOrder } from '../cart/receipt-state';
import { settleCheckout } from '../cart/settle-action';
import { settleCancellation } from '../cart/settle-cancel-action';
import { runRead } from '../catalog/catalog-reads';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * Where a buyer waits on their checkout, and then reads its receipt.
 *
 * Three states, decided only from this browser's own `httpOnly` cookies — the
 * flow id in the address is not a capability:
 *
 * - the group receipt for this flow is written → the receipt, one card per
 *   vendor order, each cancellable on its own while the window is open;
 * - the flow ticket names this flow → a client island waits on the flow's
 *   stream with the ticket's capability, and settles it when it completes;
 * - neither → the receipt has lapsed, or this was never this browser's flow.
 */
export async function OrderStatusPage({
  locale,
  flowId,
  outcome,
}: {
  readonly locale: Locale;
  readonly flowId: string;
  readonly outcome?: CancelOutcome;
}) {
  const t = getServerTFor(locale, 'r10c');
  const receipt = await readReceipt();

  if (receipt?.groupId === flowId) {
    return (
      <StoreShell locale={locale}>
        <ReceiptView locale={locale} receipt={receipt} outcome={outcome} />
      </StoreShell>
    );
  }

  const ticket = await readFlowTicket();
  if (ticket?.flowId === flowId) {
    return (
      <StoreShell locale={locale}>
        <Stack gap="l">
          <HeadingOne>{t('storefront.order.statusHeading')}</HeadingOne>
          <Card>
            <OrderStatusFlow
              flowId={flowId}
              capability={ticket.capability}
              statusHref={`/api/realtime/flow/${encodeURIComponent(
                flowId,
              )}?capability=${encodeURIComponent(ticket.capability)}`}
              locale={locale}
              labels={{
                pending: t('storefront.order.pending'),
                failed: t('storefront.order.failed'),
                retry: t('storefront.order.retry'),
              }}
              settle={settleCheckout}
              retry={checkout}
            />
          </Card>
        </Stack>
      </StoreShell>
    );
  }

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.order.expiredHeading')}</HeadingOne>
        <Stack gap="s" align="start">
          <Text muted data-testid="receipt-expired">
            {t('storefront.order.expired')}
          </Text>
          <ButtonLink href={localeHref(locale, storePaths.home())}>
            {t('storefront.order.keepShopping')}
          </ButtonLink>
        </Stack>
      </Stack>
    </StoreShell>
  );
}

/** The group receipt: one card per vendor order, and the basket's totals. */
async function ReceiptView({
  locale,
  receipt,
  outcome,
}: {
  readonly locale: Locale;
  readonly receipt: Receipt;
  readonly outcome?: CancelOutcome;
}) {
  const t = getServerTFor(locale, 'r10c');
  // When the buyer may still cancel: the nonce has to be there and the window
  // open. A counter sale carries none.
  const cancelWindow = cancelWindowLabel(locale, receipt, new Date());
  // A cancellation this browser started and is waiting on, for an order on
  // this receipt; one at a time, so the other cancel buttons wait too.
  const ticket = await readCancelTicket();
  const cancelling: CancelTicket | undefined = receipt.orders.some(
    order => order.orderId === ticket?.orderId,
  )
    ? ticket
    : undefined;
  const receiptHref = (cancel: CancelOutcome) =>
    `${localeHref(locale, storePaths.orderStatus(receipt.groupId))}?cancel=${cancel}`;

  return (
    <Stack gap="l">
      <HeadingOne>{t('storefront.order.heading')}</HeadingOne>
      <Card>
        <Stack gap="3xs">
          <Text data-testid="order-placed">{t('storefront.order.placed')}</Text>
          <Text weight="semibold" data-testid="order-id">
            {t('storefront.order.reference')}
            {': '}
            {receipt.groupId}
          </Text>
        </Stack>
      </Card>

      {outcome === 'failed' ? (
        <Card>
          <Text data-testid="cancel-failed">
            {t('storefront.order.cancelFailed')}
          </Text>
        </Card>
      ) : undefined}
      {outcome === 'pending' ? (
        <Card>
          <Text data-testid="cancel-payment-pending">
            {t('storefront.order.cancelPaymentPending')}
          </Text>
        </Card>
      ) : undefined}

      {cancelling === undefined ? undefined : (
        <Card>
          <OrderStatusFlow
            flowId={cancelling.flowId}
            capability={cancelling.capability}
            statusHref={`/api/realtime/flow/${encodeURIComponent(
              cancelling.flowId,
            )}?capability=${encodeURIComponent(cancelling.capability)}`}
            locale={locale}
            labels={{
              pending: t('storefront.order.cancelling'),
              failed: t('storefront.order.cancelFailed'),
              retry: t('storefront.order.retry'),
            }}
            settle={settleCancellation}
            settledHref={receiptHref('cancelled')}
            failedHref={receiptHref('failed')}
          />
        </Card>
      )}

      {receipt.orders.map(order => (
        <VendorOrderCard
          key={order.orderId}
          locale={locale}
          order={order}
          cancellable={
            cancelWindow !== undefined &&
            order.cancelled !== true &&
            cancelling === undefined
          }
        />
      ))}

      <Cluster justify="between" gap="s">
        {/* One total per currency: there is no exchange rate in this system,
            so a single figure would state a price nobody was charged. */}
        <Stack gap="3xs" data-testid="order-total">
          {receipt.totals.map(total => (
            <Text key={total.currency} weight="semibold">
              {t('storefront.order.total')}
              {': '}
              {formatPrice(locale, total.amount, total.currency)}
            </Text>
          ))}
        </Stack>
        <ButtonLink
          href={localeHref(locale, storePaths.home())}
          variant="secondary"
        >
          {t('storefront.order.keepShopping')}
        </ButtonLink>
      </Cluster>

      {cancelWindow === undefined ? undefined : (
        <Text muted data-testid="cancel-window">
          {t('storefront.order.cancelWindow', { time: cancelWindow })}
        </Text>
      )}
    </Stack>
  );
}

/** One vendor's order on the receipt, with its own cancel. */
async function VendorOrderCard({
  locale,
  order,
  cancellable,
}: {
  readonly locale: Locale;
  readonly order: ReceiptOrder;
  readonly cancellable: boolean;
}) {
  const t = getServerTFor(locale, 'r10c');
  // Names from the published catalog rather than the cookie: a name is long,
  // the cookie is 4 KB, and this is the read every storefront page makes.
  const lines = await Promise.all(
    (order.lines ?? []).map(async line => ({
      line,
      offering: await runRead(
        PublishedOffering,
        getOffering(line.offeringId),
        undefined,
      ),
    })),
  );

  return (
    <Card>
      <Stack gap="s" data-testid={`vendor-order-${order.vendorId}`}>
        <Cluster justify="between" gap="s">
          <Text weight="semibold">{order.vendorName ?? order.vendorId}</Text>
          <Text muted data-testid="vendor-order-method">
            {t(
              `storefront.checkout.method.${order.method === 'cod' ? 'cod' : 'card'}`,
            )}
          </Text>
        </Cluster>
        {order.cancelled === true ? (
          <Text data-testid="vendor-order-cancelled">
            {t('storefront.order.cancelled')}
          </Text>
        ) : undefined}
        {order.lines === undefined ? (
          <Text muted data-testid="order-summary-only">
            {t('storefront.order.tooManyLines', { count: order.lineCount })}
          </Text>
        ) : (
          lines.map(({ line, offering }) => (
            <Cluster key={line.offeringId} justify="between" gap="s">
              <Stack gap="3xs">
                <Text>{offering?.name ?? line.offeringId}</Text>
                <Text muted>
                  {t('storefront.order.units', { count: line.quantity })}
                </Text>
              </Stack>
              <Text>
                {formatPrice(
                  locale,
                  line.amount * line.quantity,
                  line.currency,
                )}
              </Text>
            </Cluster>
          ))
        )}
        <Cluster justify="between" gap="s">
          <Text weight="semibold">
            {formatPrice(locale, order.total.amount, order.total.currency)}
          </Text>
          {cancellable ? (
            <form action={cancelOrder}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.orderId} />
              <Button
                type="submit"
                variant="destructive"
                data-testid={`cancel-${order.vendorId}`}
              >
                {t('storefront.order.cancel')}
              </Button>
            </form>
          ) : undefined}
        </Cluster>
      </Stack>
    </Card>
  );
}
