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

import { removeFromCart } from '../cart/cart-actions';
import { readCart } from '../cart/cart-cookie';
import { cartCount } from '../cart/cart-state';
import { checkout, type CheckoutOutcome } from '../cart/checkout-action';
import { getOffering } from '../catalog/queries';
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
  const t = getServerTFor(locale, 'shell');
  const lines = await readCart();

  const items = await Promise.all(
    lines.map(async line => ({
      line,
      offering: await getOffering(line.offeringId),
    })),
  );
  // A line whose offering is gone — unpublished since it was added — is
  // dropped from the view rather than rendered nameless. The cookie keeps it
  // until the next write, which costs nothing and avoids a mutation on a read.
  const present = items.filter(entry => entry.offering !== undefined);

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
                    <Text weight="semibold">{offering?.name}</Text>
                    <Text muted>
                      {t('storefront.cart.units', { count: line.quantity })}
                    </Text>
                  </Stack>

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
              <Text weight="semibold" data-testid="cart-total">
                {t('storefront.cart.total')}
                {': '}
                {cartCount(lines)}
              </Text>
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
