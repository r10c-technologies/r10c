import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { ConfirmAction } from '@entifix/next-shell';
import {
  Alert,
  ButtonLink,
  Card,
  Cluster,
  EmptyState,
  HeadingOne,
  Money,
  Stack,
  StatusTag,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { departamentoOf, municipioOf } from '@r10c/business-ts-order-contracts';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';

import { cancelOrder } from '../cart/cancel-action';
import type { CancelOutcome } from '../cart/cancel-outcome';
import type { CancelTicket } from '../cart/cancel-ticket';
import { readCancelTicket } from '../cart/cancel-ticket-cookie';
import { cancelWindowLabel } from '../cart/cancel-window';
import { checkout } from '../cart/checkout-action';
import { readFlowTicket } from '../cart/flow-ticket-cookie';
import { OrderStatusFlow } from '../cart/order-status-flow';
import { readReceipt } from '../cart/receipt-cookie';
import { readBuyerReceiptAnswer } from '../cart/receipt-read';
import {
  lineNameKey,
  type Receipt,
  type ReceiptDelivery,
  type ReceiptDetails,
  receiptDetailsOf,
  type ReceiptOrder,
} from '../cart/receipt-state';
import { refreshCheckout, settleCheckout } from '../cart/settle-action';
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
          {/* The island above settles on the stream, which never opens
              without script; there, the buyer asks instead (#725). */}
          <noscript>
            <form action={refreshCheckout} data-testid="check-now">
              <Stack gap="s">
                <Text tone="muted">{t('storefront.order.checkNowHint')}</Text>
                <input type="hidden" name="flowId" value={flowId} />
                <input type="hidden" name="locale" value={locale} />
                <SubmitButton className="touch-target">
                  {t('storefront.order.checkNow')}
                </SubmitButton>
              </Stack>
            </form>
          </noscript>
        </Stack>
      </StoreShell>
    );
  }

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.order.expiredHeading')}</HeadingOne>
        <EmptyState
          data-testid="receipt-expired"
          action={
            <Cluster gap="s">
              <ButtonLink href={localeHref(locale, storePaths.orderFind())}>
                {t('storefront.order.findLink')}
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                href={localeHref(locale, storePaths.home())}
              >
                {t('storefront.order.keepShopping')}
              </ButtonLink>
            </Cluster>
          }
        >
          {t('storefront.order.expired')}
        </EmptyState>
      </Stack>
    </StoreShell>
  );
}

/**
 * A receipt whose capability was re-keyed elsewhere: say so, and offer the
 * lookup rather than a receipt nothing behind it will read or cancel.
 */
function ReceiptMoved({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'r10c');
  return (
    <Stack gap="l">
      <HeadingOne>{t('storefront.order.movedHeading')}</HeadingOne>
      <EmptyState
        data-testid="receipt-moved"
        action={
          <ButtonLink href={localeHref(locale, storePaths.orderFind())}>
            {t('storefront.order.findLink')}
          </ButtonLink>
        }
      >
        {t('storefront.order.moved')}
      </EmptyState>
    </Stack>
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
  // What the cookie never keeps — where it goes, and each line's stored name —
  // read from the server on every render by the receipt's own capability. A
  // read that fails renders from the cookie alone (ADR 0076 §1, §6).
  const answer =
    receipt.cancelNonce === undefined
      ? undefined
      : await readBuyerReceiptAnswer(receipt.groupId, receipt.cancelNonce);
  // The nonce no longer opens this group: an access link re-keyed it on
  // another device, and this browser's receipt is spent (ADR 0076 §6).
  if (answer?.kind === 'refused') return <ReceiptMoved locale={locale} />;
  const details =
    answer?.kind === 'read' ? receiptDetailsOf(answer.body) : undefined;
  // When the buyer may still cancel: the nonce has to be there and the window
  // open. A counter sale carries none.
  const cancelWindow = cancelWindowLabel(locale, receipt, new Date());
  const readableUntil =
    receipt.receiptEndsAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(receipt.receiptEndsAt),
        );
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
  // Once every order on it is cancelled, the receipt no longer thanks anyone
  // for a purchase that did not happen (a3-2): it says what did.
  const allCancelled = receipt.orders.every(order => order.cancelled === true);

  return (
    <Stack gap="l">
      <HeadingOne>
        {allCancelled
          ? t('storefront.order.cancelledHeading')
          : t('storefront.order.heading')}
      </HeadingOne>
      <Card>
        <Stack gap="3xs">
          <Text data-testid="order-placed">
            {allCancelled
              ? t('storefront.order.cancelledAll')
              : t('storefront.order.placed')}
          </Text>
          {/* The number the buyer can read out, never the group's UUID
              (ADR 0076 §5). */}
          {receipt.number === undefined ? undefined : (
            <Text weight="semibold" data-testid="order-id">
              {t('storefront.order.reference')}
              {': '}
              {receipt.number}
            </Text>
          )}
        </Stack>
      </Card>

      {details?.delivery === undefined ? undefined : (
        <DeliveryCard locale={locale} delivery={details.delivery} />
      )}

      {details?.billedTo === undefined ? undefined : (
        <Card>
          <Text data-testid="order-billed-to">
            {details.billedTo.idType === 'cf'
              ? t('storefront.order.billedToCf')
              : t('storefront.order.billedTo', {
                  name: details.billedTo.name,
                  idType: details.billedTo.idType.toUpperCase(),
                  taxId: details.billedTo.taxId,
                })}
          </Text>
        </Card>
      )}

      {outcome === 'failed' ? (
        <Alert tone="danger" data-testid="cancel-failed">
          {t('storefront.order.cancelFailed')}
        </Alert>
      ) : undefined}
      {outcome === 'pending' ? (
        <Alert tone="warning" data-testid="cancel-payment-pending">
          {t('storefront.order.cancelPaymentPending')}
        </Alert>
      ) : undefined}
      {outcome === 'cancelled' ? (
        <Alert tone="success" data-testid="cancel-done">
          {t('storefront.order.cancelled')}
        </Alert>
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
          details={details}
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
              <Money
                amount={total.amount}
                currency={total.currency}
                unit="minor"
                locale={locale}
              />
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
      {readableUntil === undefined ? undefined : (
        <Text muted data-testid="receipt-until">
          {t('storefront.order.receiptUntil', { date: readableUntil })}
        </Text>
      )}
    </Stack>
  );
}

/** One vendor's order on the receipt, with its own cancel. */
async function VendorOrderCard({
  locale,
  order,
  details,
  cancellable,
}: {
  readonly locale: Locale;
  readonly order: ReceiptOrder;
  readonly details: ReceiptDetails | undefined;
  readonly cancellable: boolean;
}) {
  const t = getServerTFor(locale, 'r10c');
  // Each line under the name it was sold as, read back with the receipt
  // (#582); the live catalog's name only when that read failed. Never from
  // the cookie: a name is long, and the cookie is 4 KB.
  const lines = await Promise.all(
    (order.lines ?? []).map(async line => ({
      line,
      name:
        details?.lineNames.get(lineNameKey(order.orderId, line.offeringId)) ??
        (
          await runRead(
            PublishedOffering,
            getOffering(line.offeringId),
            undefined,
          )
        )?.name,
    })),
  );

  const iva = details?.ivaIncluded.get(order.orderId);

  return (
    <Card>
      <Stack gap="s" data-testid={`vendor-order-${order.vendorId}`}>
        <Cluster justify="between" gap="s">
          <Stack gap="3xs">
            <Text weight="semibold">{order.vendorName ?? order.vendorId}</Text>
            {order.number === undefined ? undefined : (
              <Text muted data-testid="vendor-order-number">
                {t('storefront.order.vendorNumber', { number: order.number })}
              </Text>
            )}
          </Stack>
          <Text muted data-testid="vendor-order-method">
            {t(
              `storefront.checkout.method.${order.method === 'cod' ? 'cod' : 'card'}`,
            )}
          </Text>
        </Cluster>
        {order.cancelled === true ? (
          <span>
            <StatusTag tone="neutral" data-testid="vendor-order-cancelled">
              {t('storefront.order.cancelledTag')}
            </StatusTag>
          </span>
        ) : undefined}
        {order.lines === undefined ? (
          <Text muted data-testid="order-summary-only">
            {t('storefront.order.tooManyLines', { count: order.lineCount })}
          </Text>
        ) : (
          lines.map(({ line, name }) => (
            <Cluster key={line.offeringId} justify="between" gap="s">
              <Stack gap="3xs">
                <Text data-testid="vendor-order-line">
                  {name ?? line.offeringId}
                </Text>
                <Text muted>
                  {t('storefront.order.units', { count: line.quantity })}
                </Text>
              </Stack>
              <Text>
                <Money
                  amount={line.amount * line.quantity}
                  currency={line.currency}
                  unit="minor"
                  locale={locale}
                />
              </Text>
            </Cluster>
          ))
        )}
        <Cluster justify="between" gap="s">
          <Stack gap="3xs">
            <Text weight="semibold">
              <Money
                amount={order.total.amount}
                currency={order.total.currency}
                unit="minor"
                locale={locale}
              />
            </Text>
            {iva === undefined ? undefined : (
              <Text muted data-testid="vendor-order-iva">
                {t('storefront.order.ivaIncluded')}{' '}
                <Money
                  amount={iva}
                  currency={order.total.currency}
                  unit="minor"
                  locale={locale}
                />
              </Text>
            )}
          </Stack>
          {/* Asks first, with or without JavaScript: the title names the
              order, the message states the refund, and only the confirming
              post acts (a3-2, entifix ADR 0026). */}
          {cancellable ? (
            <div data-testid={`cancel-${order.vendorId}`}>
              <ConfirmAction
                action={cancelOrder}
                fields={{ locale, orderId: order.orderId }}
                tone="destructive"
                title={t('storefront.order.cancelTitle', {
                  seller: order.vendorName ?? order.vendorId,
                })}
                message={t('storefront.order.cancelMessage')}
                confirmLabel={t('storefront.order.cancelConfirm')}
                cancelLabel={t('storefront.order.cancelKeep')}
              >
                {t('storefront.order.cancel')}
              </ConfirmAction>
            </div>
          ) : undefined}
        </Cluster>
      </Stack>
    </Card>
  );
}

/**
 * Where the parcels go and who receives them, as the buyer gave it — the phone
 * masked to its last four digits, so a receipt left open on a shared screen
 * shows no whole number (ADR 0076 §1).
 */
function DeliveryCard({
  locale,
  delivery,
}: {
  readonly locale: Locale;
  readonly delivery: ReceiptDelivery;
}) {
  const t = getServerTFor(locale, 'r10c');
  const place = [
    municipioOf(delivery.municipio)?.name,
    departamentoOf(delivery.departamento)?.name,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Card>
      <Stack gap="3xs" data-testid="order-delivery">
        <Text weight="semibold">{t('storefront.order.delivery.heading')}</Text>
        <Text>{delivery.name}</Text>
        <Text data-testid="order-delivery-phone">
          {t('storefront.order.delivery.phone', {
            ending: delivery.phoneEnding,
          })}
        </Text>
        <Text>{delivery.addressLine}</Text>
        {delivery.zona === undefined ? undefined : (
          <Text>
            {t('storefront.order.delivery.zona', { zona: delivery.zona })}
          </Text>
        )}
        <Text data-testid="order-delivery-place">{place}</Text>
        {delivery.reference === undefined ? undefined : (
          <Text muted>{delivery.reference}</Text>
        )}
      </Stack>
    </Card>
  );
}
