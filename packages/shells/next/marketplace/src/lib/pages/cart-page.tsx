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
import { getProduct } from '../catalog/queries';
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
export async function CartPage({ locale }: { readonly locale: Locale }) {
  const t = getServerTFor(locale, 'shell');
  const lines = await readCart();

  const items = await Promise.all(
    lines.map(async line => ({
      line,
      product: await getProduct(line.code),
    })),
  );
  const present = items.filter(entry => entry.product !== undefined);

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.cart.heading')}</HeadingOne>

        {present.length === 0 ? (
          <Stack gap="s" align="start">
            <Text muted>{t('storefront.cart.empty')}</Text>
            <ButtonLink href={localeHref(locale, storePaths.home())}>
              {t('storefront.cart.keepShopping')}
            </ButtonLink>
          </Stack>
        ) : (
          <Stack gap="s">
            {present.map(({ line, product }) => (
              <Card key={line.code}>
                <Cluster justify="between" gap="s">
                  <Stack gap="3xs">
                    <Text weight="semibold">{product?.name}</Text>
                    <Text muted>
                      {t('storefront.cart.units', { count: line.quantity })}
                    </Text>
                  </Stack>

                  <form action={removeFromCart}>
                    <input type="hidden" name="code" value={line.code} />
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
              <ButtonLink
                href={localeHref(locale, storePaths.home())}
                variant="secondary"
              >
                {t('storefront.cart.keepShopping')}
              </ButtonLink>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </StoreShell>
  );
}
