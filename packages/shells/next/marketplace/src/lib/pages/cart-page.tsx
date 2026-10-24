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

import { removeFromCart } from '../cart/cart-actions';
import { readCart } from '../cart/cart-cookie';
import { checkout, type CheckoutOutcome } from '../cart/checkout-action';
import { runRead } from '../catalog/catalog-reads';
import { totalsByCurrency } from '../catalog/money';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * The cart, rendered from the cookie the request carried.
 *
 * This is the payoff for keeping cart state in a cookie rather than in the
 * browser: the first response already contains the visitor's items. A
 * `localStorage` cart would have to render this page empty and correct itself
 * after hydration — which is both a visible flash and, for a page whose whole
 * job is to be trustworthy about what you are buying, the wrong default.
 *
 * Dynamic by necessity, not by accident: `readCart` reads `cookies()`.
 */
export async function CartPage({
  locale,
  outcome,
}: {
  readonly locale: Locale;
  /** What a previous checkout attempt did, carried back on the query string. */
  readonly outcome?: CheckoutOutcome;
}) {
  const t = getServerTFor(locale, 'r10c');
  const lines = await readCart();

  const items = await Promise.all(
    lines.map(async line => ({
      line,
      offering: await runRead(
        PublishedOffering,
        getOffering(line.offeringId),
        undefined,
      ),
    })),
  );
  // A line whose offering is gone — unpublished since it was added — is
  // dropped from the view rather than rendered nameless. The cookie keeps it
  // until the next write, which costs nothing and avoids a mutation on a read.
  const present = items.flatMap(({ line, offering }) =>
    offering === undefined ? [] : [{ line, offering }],
  );
  // Summed over what is shown, not over the cookie: a dropped line must not
  // keep adding to a figure the buyer cannot trace back to a row.
  const totals = totalsByCurrency(
    present.map(({ line, offering }) => ({
      amount: offering.amount,
      currency: offering.currency,
      quantity: line.quantity,
    })),
  );

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.cart.heading')}</HeadingOne>

        {outcome !== undefined && (
          <Card>
            {/* ⚠️ `unavailable` is the saga's `409`: a line was refused and every
                hold it had taken was given back. That is a stock outcome the
                buyer can act on, not a failure to apologise for — so it reads
                as its own message rather than folding into an error. */}
            <Text data-testid={`checkout-${outcome}`}>
              {t(`storefront.checkout.${outcome}`)}
            </Text>
          </Card>
        )}

        {present.length === 0 ? (
          <Stack gap="s" align="start">
            <Text muted>{t('storefront.cart.empty')}</Text>
            <ButtonLink href={localeHref(locale, storePaths.home())}>
              {t('storefront.cart.keepShopping')}
            </ButtonLink>
          </Stack>
        ) : (
          <Stack gap="s">
            {present.map(({ line, offering }) => (
              <Card key={line.offeringId}>
                <Cluster justify="between" gap="s">
                  <Stack gap="3xs">
                    <Text weight="semibold">{offering.name}</Text>
                    <Text muted>
                      {t('storefront.cart.units', { count: line.quantity })}
                    </Text>
                  </Stack>

                  <Text data-testid="cart-line-price">
                    {formatPrice(
                      locale,
                      offering.amount * line.quantity,
                      offering.currency,
                    )}
                  </Text>

                  <form action={removeFromCart}>
                    <input
                      type="hidden"
                      name="offeringId"
                      value={line.offeringId}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {t('storefront.cart.remove')}
                    </Button>
                  </form>
                </Cluster>
              </Card>
            ))}

            <Cluster justify="between" gap="s">
              {/* One total per currency, summed the way the receipt sums it,
                  so the figure before checkout is the figure after it. */}
              <Stack gap="3xs" data-testid="cart-total">
                {totals.map(total => (
                  <Text key={total.currency} weight="semibold">
                    {t('storefront.cart.total')}
                    {': '}
                    {formatPrice(locale, total.amount, total.currency)}
                  </Text>
                ))}
              </Stack>
              <Cluster gap="s">
                <ButtonLink
                  href={localeHref(locale, storePaths.home())}
                  variant="secondary"
                >
                  {t('storefront.cart.keepShopping')}
                </ButtonLink>
                <form action={checkout}>
                  <input type="hidden" name="locale" value={locale} />
                  <Button type="submit" data-testid="checkout">
                    {t('storefront.cart.checkout')}
                  </Button>
                </form>
              </Cluster>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </StoreShell>
  );
}
