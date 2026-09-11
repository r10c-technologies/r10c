import {
  Button,
  ButtonLink,
  Card,
  Cluster,
  HeadingOne,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import { type Locale, localeHref } from '@r10c/entifix-ts-i18n/routing';

import { cancelOrder, type CancelOutcome } from '../cart/cancel-action';
import { cancelWindowLabel } from '../cart/cancel-window';
import { readReceipt } from '../cart/receipt-cookie';
import { formatMoney } from '../catalog/money';
import { getOffering } from '../catalog/queries';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * What a buyer sees when a checkout succeeds.
 *
 * ⚠️ **It renders the order the saga returned, and reads no service to do it.**
 * The storefront holds no session, and order-service's reads take a session and
 * no token — so the alternatives were a buyer account the storefront has not
 * got, or a public read surface on a store holding every buyer's receipts. The
 * write already answered with the whole order, so neither is needed
 * ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * ⚠️ **The address identifies nothing.** An order id in a URL is a capability,
 * and a guessable one is somebody else's receipt; this page is the same path for
 * everybody and the receipt travels in an `httpOnly` cookie the browser only
 * sends back to its own session.
 *
 * The cost is stated on screen rather than hidden: the receipt expires, and a
 * visit after that renders an expired state instead of an error. A durable list
 * is "my orders", which needs a buyer identity — and `buyerId` is optional on
 * purpose, so acquiring one cannot become the price of buying something
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * ⚠️ **It shows placed or cancelled, and never a status.** The receipt carries
 * no `status`, because there is no honest one to carry: the order is `pending`
 * when the write returns and the capture that makes it `paid` lands later in the
 * same flow. What the page can say truthfully is what it watched happen — so a
 * cancel writes {@link Receipt.cancelled} into the cookie and the page renders
 * from that, rather than re-reading an order it has no credential for
 * ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
 *
 * Dynamic by necessity: it reads `cookies()`.
 */
export async function OrderConfirmationPage({
  locale,
  outcome,
}: {
  readonly locale: Locale;
  /** What a cancel attempt did, carried back on the query string. */
  readonly outcome?: CancelOutcome;
}) {
  const t = getServerTFor(locale, 'shell');
  const receipt = await readReceipt();

  if (!receipt) {
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

  // When the buyer may still cancel, or `undefined` when they may not.
  //
  // ⚠️ **Three things must all hold, and the page checks every one before it
  // draws anything.** The nonce has to be there — a counter sale carries none,
  // and so does a checkout that predates the capability. The window has to be
  // there and still open. And the order must not already be cancelled. The rule
  // `receipt-state.ts` states is that a page offers the cancel only when it can,
  // rather than rendering a button and discovering the answer from a `401`.
  const cancelWindow = cancelWindowLabel(locale, receipt, new Date());

  // The names are looked up from the published catalog the storefront already
  // reads, rather than carried in the cookie: a name is long, the cookie is
  // 4KB, and this read is the same one every other storefront page makes. A
  // line whose offering has since been unpublished falls back to its id, which
  // is the reference a buyer can quote back.
  const lines = await Promise.all(
    (receipt.lines ?? []).map(async line => ({
      line,
      offering: await getOffering(line.offeringId),
    })),
  );

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.order.heading')}</HeadingOne>

        <Card>
          <Stack gap="3xs">
            <Text data-testid="order-placed">
              {receipt.cancelled
                ? t('storefront.order.cancelled')
                : t('storefront.order.placed')}
            </Text>
            <Text weight="semibold" data-testid="order-id">
              {t('storefront.order.reference')}
              {': '}
              {receipt.orderId}
            </Text>
          </Stack>
        </Card>

        {outcome === 'failed' && !receipt.cancelled ? (
          <Card>
            <Text data-testid="cancel-failed">
              {t('storefront.order.cancelFailed')}
            </Text>
          </Card>
        ) : undefined}

        {receipt.lines === undefined ? (
          // The whole basket did not fit in the cookie. It says how many lines
          // there were rather than showing some of them: a partial list read as
          // the whole order is a receipt that lies about what was bought.
          <Card>
            <Text muted data-testid="order-summary-only">
              {t('storefront.order.tooManyLines', { count: receipt.lineCount })}
            </Text>
          </Card>
        ) : (
          <Stack gap="s">
            {lines.map(({ line, offering }) => (
              <Card key={line.offeringId}>
                <Cluster justify="between" gap="s">
                  <Stack gap="3xs">
                    <Text weight="semibold">
                      {offering?.name ?? line.offeringId}
                    </Text>
                    <Text muted>
                      {t('storefront.order.units', { count: line.quantity })}
                    </Text>
                  </Stack>
                  <Text>
                    {formatMoney(
                      locale,
                      line.amount * line.quantity,
                      line.currency,
                    )}
                  </Text>
                </Cluster>
              </Card>
            ))}
          </Stack>
        )}

        <Cluster justify="between" gap="s">
          {/* One total per currency. A basket can span vendors pricing in
              different ones, and there is no exchange rate in this system — a
              single figure would state a price nobody was charged. */}
          <Stack gap="3xs" data-testid="order-total">
            {receipt.totals.map(total => (
              <Text key={total.currency} weight="semibold">
                {t('storefront.order.total')}
                {': '}
                {formatMoney(locale, total.amount, total.currency)}
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
          <Card>
            <Stack gap="s" align="start">
              {/* The window is *named* rather than left for the button to stop
                  working on its own. The receipt carries the moment the server
                  stamped, and the two agree because `RECEIPT_TTL_SECONDS` and
                  order-service's own dial are one number (ADR 0058 §5). */}
              <Text muted data-testid="cancel-window">
                {t('storefront.order.cancelWindow', { time: cancelWindow })}
              </Text>
              {/* A plain form posting to a Server Action: it works with
                  JavaScript disabled, needs no client island, and keeps the
                  nonce on the server — the same shape every cart mutation
                  uses. The order id is not a field, because the action reads it
                  from the same cookie the nonce came from. */}
              <form action={cancelOrder}>
                <input type="hidden" name="locale" value={locale} />
                <Button type="submit" variant="destructive">
                  {t('storefront.order.cancel')}
                </Button>
              </form>
            </Stack>
          </Card>
        )}
      </Stack>
    </StoreShell>
  );
}
