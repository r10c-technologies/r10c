import { formattingLocale, type Locale, localeHref } from '@entifix/core';
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
  TextInput,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  departamentoOf,
  municipioOf,
  whatsappChatUrl,
} from '@r10c/business-ts-order-contracts';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import { getVendor } from '@r10c/implementation-marketplace-vendor-next';

import { cancelOrder } from '../cart/cancel-action';
import type { CancelOutcome } from '../cart/cancel-outcome';
import type { CancelTicket } from '../cart/cancel-ticket';
import { readCancelTicket } from '../cart/cancel-ticket-cookie';
import { cancelWindowLabel } from '../cart/cancel-window';
import { checkout } from '../cart/checkout-action';
import { attachPaymentReceipt } from '../cart/evidence-action';
import type { EvidenceOutcome } from '../cart/evidence-outcome';
import { readFlowTicket } from '../cart/flow-ticket-cookie';
import { OrderStatusFlow } from '../cart/order-status-flow';
import { readReceiptTicket } from '../cart/receipt-cookie';
import {
  lineNameKey,
  type ReceiptDelivery,
  type ReceiptDetails,
  receiptDetailsOf,
  type ReceiptOrder,
  type ReceiptPayment,
  type ReceiptTicket,
} from '../cart/receipt-state';
import { ReceiptWatch } from '../cart/receipt-watch';
import { readReceipt } from '../cart/receipt-write';
import { refreshCheckout, settleCheckout } from '../cart/settle-action';
import { settleCancellation } from '../cart/settle-cancel-action';
import { runRead } from '../catalog/catalog-reads';
import { quantityLabel } from '../catalog/price-basis';
import { storePaths } from '../routing/paths';
import { OrderTracker } from './order-tracker';
import { StoreShell } from './store-shell';

/**
 * Where a buyer waits on their checkout, and then reads its receipt.
 *
 * Three states, decided only from this browser's own `httpOnly` cookies — the
 * flow id in the address is not a capability:
 *
 * - the receipt ticket for this flow is written → the receipt, read back by
 *   its capability: one card per vendor order, each cancellable on its own
 *   while the window is open;
 * - the flow ticket names this flow → a client island waits on the flow's
 *   stream with the ticket's capability, and settles it when it completes;
 * - neither → the receipt has lapsed, or this was never this browser's flow.
 */
export async function OrderStatusPage({
  locale,
  flowId,
  outcome,
  evidenceOutcome,
}: {
  readonly locale: Locale;
  readonly flowId: string;
  readonly outcome?: CancelOutcome;
  /** What a receipt upload did, for exactly one navigation (ADR 0081 §6). */
  readonly evidenceOutcome?: EvidenceOutcome;
}) {
  const t = getServerTFor(locale, 'r10c');
  const kept = await readReceiptTicket();

  if (kept?.groupId === flowId) {
    return (
      <StoreShell locale={locale}>
        <ReceiptView
          locale={locale}
          ticket={kept}
          outcome={outcome}
          evidenceOutcome={evidenceOutcome}
        />
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

/**
 * A receipt whose read did not answer: say so, with the number the buyer can
 * quote and a way to try again, rather than a receipt with nothing in it
 * (ADR 0051: a failed read still renders, and says it failed).
 */
function ReceiptUnavailable({
  locale,
  ticket,
}: {
  readonly locale: Locale;
  readonly ticket: ReceiptTicket;
}) {
  const t = getServerTFor(locale, 'r10c');
  return (
    <Stack gap="l">
      <HeadingOne>{t('storefront.order.heading')}</HeadingOne>
      {ticket.number === undefined ? undefined : (
        <Text weight="semibold" data-testid="order-id">
          {t('storefront.order.reference')}
          {': '}
          {ticket.number}
        </Text>
      )}
      <Alert tone="danger" data-testid="receipt-unavailable">
        {t('storefront.order.unavailable')}
      </Alert>
      <Cluster gap="s">
        <ButtonLink
          href={localeHref(locale, storePaths.orderStatus(ticket.groupId))}
        >
          {t('storefront.order.retry')}
        </ButtonLink>
      </Cluster>
    </Stack>
  );
}

/** The group receipt: one card per vendor order, and the basket's totals. */
async function ReceiptView({
  locale,
  ticket,
  outcome,
  evidenceOutcome,
}: {
  readonly locale: Locale;
  readonly ticket: ReceiptTicket;
  readonly outcome?: CancelOutcome;
  readonly evidenceOutcome?: EvidenceOutcome;
}) {
  const tErrors = getServerTFor(locale, 'errors');
  const t = getServerTFor(locale, 'r10c');
  // The cookie keeps only the capability; the orders, their lines and status,
  // where it goes and each line's stored name are read from the server on
  // every render by it (ADR 0053, ADR 0076 §1, §6).
  const read = await readReceipt(ticket);
  // The nonce no longer opens this group: an access link re-keyed it on
  // another device, and this browser's receipt is spent (ADR 0076 §6).
  if (read.kind === 'refused') return <ReceiptMoved locale={locale} />;
  if (read.kind === 'failed') {
    return <ReceiptUnavailable locale={locale} ticket={ticket} />;
  }
  const { receipt } = read;
  const details = receiptDetailsOf(read.body);
  // When the buyer may still cancel: the nonce has to be there and the window
  // open. A counter sale carries none.
  const cancelWindow = cancelWindowLabel(locale, receipt, new Date());
  const readableUntil =
    receipt.receiptEndsAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(formattingLocale(locale), {
          dateStyle: 'long',
        }).format(new Date(receipt.receiptEndsAt));
  // A cancellation this browser started and is waiting on, for an order on
  // this receipt; one at a time, so the other cancel buttons wait too.
  const cancelTicket = await readCancelTicket();
  const cancelling: CancelTicket | undefined = receipt.orders.some(
    order => order.orderId === cancelTicket?.orderId,
  )
    ? cancelTicket
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
      {evidenceOutcome === undefined ? undefined : evidenceOutcome ===
        'attached' ? (
        <Alert tone="success" data-testid="evidence-attached">
          {t('storefront.order.payment.evidence.attached')}
        </Alert>
      ) : (
        <Alert tone="danger" data-testid="evidence-refused">
          {evidenceOutcome === 'failed'
            ? t('storefront.order.payment.evidence.failed')
            : tErrors(evidenceOutcome)}
        </Alert>
      )}

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

      {/* A dispatch or a delivery re-renders this page by push; without
          script, a reload shows the same (ADR 0081 §11). */}
      <ReceiptWatch
        capability={receipt.cancelNonce}
        orderIds={receipt.orders.map(order => order.orderId)}
      />
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

/**
 * Which prefilled message a chat with the seller opens on: where the order
 * stands, so the seller reads the question in context (#671).
 */
const chatStepOf = (status: string | undefined) => {
  switch (status) {
    case 'awaiting-payment':
      return 'awaitingPayment';
    case 'dispatched':
      return 'dispatched';
    case 'fulfilled':
      return 'delivered';
    default:
      return 'placed';
  }
};

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
  // (#582); the live catalog's name only when the read named none.
  const lines = await Promise.all(
    order.lines.map(async line => ({
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
  const payment = details?.payments.get(order.orderId);
  const tracking = details?.tracking.get(order.orderId);
  const fiscal = details?.fiscal.get(order.orderId);
  // A chat with the seller, prefilled with the order and where it stands
  // (#671): the number is the seller's own, read from its published record.
  const vendor = await runRead(
    PublishedVendor,
    getVendor(order.vendorId),
    undefined,
  );
  const chat = whatsappChatUrl(
    vendor?.whatsappNumber,
    t(`storefront.order.whatsapp.text.${chatStepOf(tracking?.status)}`, {
      number: order.number ?? order.orderId,
    }),
  );

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
              `storefront.checkout.method.${order.method === 'cod' || order.method === 'link' ? order.method : 'card'}`,
            )}
          </Text>
        </Cluster>
        {payment === undefined ? undefined : (
          <LinkPayment
            locale={locale}
            orderId={order.orderId}
            payment={payment}
          />
        )}
        {order.cancelled === true ? (
          <span>
            <StatusTag tone="neutral" data-testid="vendor-order-cancelled">
              {t('storefront.order.cancelledTag')}
            </StatusTag>
          </span>
        ) : undefined}
        {tracking === undefined || order.cancelled === true ? undefined : (
          <OrderTracker locale={locale} tracking={tracking} />
        )}
        {chat === undefined ? undefined : (
          <a
            href={chat}
            target="_blank"
            rel="noreferrer noopener"
            className="touch-target underline"
            data-testid="vendor-order-whatsapp"
          >
            {t('storefront.order.whatsapp.label')}
          </a>
        )}
        {lines.map(({ line, name }) => (
          <Cluster key={line.offeringId} justify="between" gap="s">
            <Stack gap="3xs">
              <Text data-testid="vendor-order-line">
                {name ?? line.offeringId}
              </Text>
              <Text muted>
                {t('storefront.order.units', {
                  quantity: quantityLabel(
                    (key, values) => (values ? t(key, values) : t(key)),
                    locale,
                  )(line.quantity, line.unit),
                })}
              </Text>
            </Stack>
            <Text>
              <Money
                amount={line.lineTotal}
                currency={line.currency}
                unit="minor"
                locale={locale}
              />
            </Text>
          </Cluster>
        ))}
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
            {fiscal === undefined ? undefined : (
              <Text muted data-testid="vendor-order-fiscal">
                {fiscal.state === 'pending'
                  ? t('storefront.order.fiscal.pending')
                  : t(`storefront.order.fiscal.${fiscal.state}`, {
                      type: fiscal.type ?? '',
                      series: fiscal.series ?? '',
                      number: fiscal.number ?? '',
                      authorization: fiscal.authorization ?? '',
                    })}
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

/**
 * A payment-link order's state for its buyer (ADR 0081): waiting until when,
 * and the seller's link to pay by — or that it expired unpaid. A provider
 * nobody listed shows its host in full beside the button, so the buyer sees
 * whose link it is before following it (§10).
 */
function LinkPayment({
  locale,
  orderId,
  payment,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly payment: ReceiptPayment;
}) {
  const t = getServerTFor(locale, 'r10c');
  if (payment.expired) {
    return (
      <Text muted data-testid="vendor-order-payment-expired">
        {t('storefront.order.payment.expired')}
      </Text>
    );
  }
  if (!payment.awaiting) return undefined;
  const until =
    payment.dueAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(formattingLocale(locale), {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(payment.dueAt));
  return (
    <Stack gap="2xs" data-testid="vendor-order-payment">
      <span>
        <StatusTag tone="warning" data-testid="vendor-order-awaiting">
          {t('storefront.order.payment.awaiting')}
        </StatusTag>
      </span>
      {until === undefined ? undefined : (
        <Text muted>
          {t('storefront.order.payment.until', { time: until })}
        </Text>
      )}
      {payment.link === undefined ? (
        <Text muted data-testid="vendor-order-no-link">
          {t('storefront.order.payment.noLink')}
        </Text>
      ) : (
        <Stack gap="3xs">
          <ButtonLink
            href={payment.link.url}
            rel="noopener noreferrer"
            target="_blank"
            data-testid="vendor-order-pay-link"
          >
            {t('storefront.order.payment.pay', {
              provider: payment.link.providerName,
            })}
          </ButtonLink>
          {payment.link.unlisted ? (
            <Text muted data-testid="vendor-order-link-host">
              {t('storefront.order.payment.unlisted', {
                host: payment.link.host,
              })}
            </Text>
          ) : undefined}
        </Stack>
      )}
      <PaymentEvidence locale={locale} orderId={orderId} payment={payment} />
    </Stack>
  );
}

/**
 * The receipts a buyer attached to an order that waits for its payment, each
 * read back through the storefront's own origin, and the form that attaches
 * another (ADR 0081 §6). A plain multipart post: it works with scripting off.
 */
function PaymentEvidence({
  locale,
  orderId,
  payment,
}: {
  readonly locale: Locale;
  readonly orderId: string;
  readonly payment: ReceiptPayment;
}) {
  const t = getServerTFor(locale, 'r10c');
  const inputId = `evidence-${orderId}`;
  return (
    <Stack gap="3xs" data-testid="vendor-order-evidence">
      <Text weight="semibold">
        {t('storefront.order.payment.evidence.title')}
      </Text>
      {payment.evidence.length === 0 ? undefined : (
        <ul className="flex flex-col gap-3xs" data-testid="evidence-list">
          {payment.evidence.map((entry, index) => (
            <li key={entry.id}>
              <a
                className="underline"
                href={`/api/receipt-evidence/${encodeURIComponent(
                  orderId,
                )}/${encodeURIComponent(entry.id)}`}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t('storefront.order.payment.evidence.attachedOne', {
                  n: index + 1,
                  kind: t(`storefront.order.payment.evidence.${entry.kind}`),
                })}
              </a>
            </li>
          ))}
        </ul>
      )}
      <form
        action={attachPaymentReceipt}
        encType="multipart/form-data"
        data-testid="evidence-form"
      >
        <Stack gap="3xs">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orderId" value={orderId} />
          <label htmlFor={inputId} className="text-step--1 font-semibold">
            {t('storefront.order.payment.evidence.file')}
          </label>
          <Text muted id={`${inputId}-hint`}>
            {t('storefront.order.payment.evidence.hint')}
          </Text>
          <TextInput
            id={inputId}
            name="receipt"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-describedby={`${inputId}-hint`}
            className="w-full min-w-0"
            required
          />
          <div>
            <SubmitButton variant="secondary">
              {t('storefront.order.payment.evidence.submit')}
            </SubmitButton>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}
