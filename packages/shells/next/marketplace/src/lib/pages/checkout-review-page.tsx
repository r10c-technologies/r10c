import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Alert,
  ButtonLink,
  Card,
  Cluster,
  HeadingOne,
  HeadingTwo,
  Money,
  Stack,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { redirect } from 'next/navigation';

import { checkout } from '../cart/checkout-action';
import { tenderField, tenderOf } from '../cart/checkout-start';
import { readPricedCart } from '../cart/priced-cart';
import { reviewedTotalsOf } from '../cart/priced-cart-state';
import { runRead } from '../catalog/catalog-reads';
import { totalsByCurrency } from '../catalog/money';
import { storePaths, type TenderChoice } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * The step between the cart and the checkout: everything the buyer is about
 * to commit to, on one page, before anything starts — each seller's lines, how
 * each seller is paid, and the total.
 *
 * It exists because a checkout is the one act on the storefront that cannot be
 * walked back in the same breath: it reserves stock, opens an order per seller
 * and, on a card, takes money. The cart is where a basket is edited; this is
 * where it is agreed to.
 *
 * Plain forms, like the cart: the tenders arrive on the query string from the
 * cart's `GET` form, and Place order posts the checkout action with the totals
 * shown here. The action re-prices from the published catalog and, if that no
 * longer matches what was reviewed, sends the buyer back here to look again.
 * Dynamic for the same reason as the cart — it reads the cookie.
 */
export async function CheckoutReviewPage({
  locale,
  tenders,
  changed = false,
}: {
  readonly locale: Locale;
  /** The tender the buyer picked for each seller, by vendor id. */
  readonly tenders: TenderChoice;
  /**
   * The checkout sent the buyer back: a price moved, or a line stopped being
   * sold, between this page and Place order.
   */
  readonly changed?: boolean;
}) {
  const t = getServerTFor(locale, 'r10c');
  const { parts, offerings, totals, unavailable } = await readPricedCart(
    vendorId => tenderOf(tenders[vendorId]),
  );
  // Nothing to agree to: the cart says why, and offers the way back.
  if (parts.length === 0) {
    redirect(localeHref(locale, `${storePaths.cart()}?checkout=empty`));
  }
  const vendors = new Map(
    (
      await runRead(
        PublishedVendor,
        loadVendors(parts.map(part => part.vendorId)),
        [],
      )
    ).map(vendor => [vendor.vendorId, vendor]),
  );
  const chosen = Object.fromEntries(
    parts.map(part => [part.vendorId, part.paymentMethod]),
  );

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <Stack gap="2xs">
          <HeadingOne>{t('storefront.review.heading')}</HeadingOne>
          <Text tone="muted">{t('storefront.review.intro')}</Text>
        </Stack>

        {changed && (
          <Alert tone="warning" data-testid="review-changed">
            {t('storefront.review.changed')}
          </Alert>
        )}
        {/* Said, not just left out: the buyer added these, and is agreeing to
            an order without them. */}
        {unavailable > 0 && (
          <Alert tone="info" data-testid="review-unavailable">
            {t('storefront.review.unavailable')}
          </Alert>
        )}

        <Stack gap="s">
          {parts.map(part => {
            const seller =
              vendors.get(part.vendorId)?.displayName ?? part.vendorId;
            const subtotals = totalsByCurrency(part.lines);
            return (
              <Card key={part.vendorId}>
                <Stack gap="s" data-testid={`review-seller-${part.vendorId}`}>
                  <HeadingTwo>{seller}</HeadingTwo>
                  <ul className="m-0 flex list-none flex-col gap-2xs p-0">
                    {part.lines.map(line => {
                      const name = offerings.get(line.offeringId)?.name;
                      return (
                        <li key={line.offeringId}>
                          <Cluster justify="between" gap="s">
                            <Text>
                              {name}
                              {' · '}
                              {t('storefront.order.units', {
                                count: line.quantity,
                              })}
                            </Text>
                            <Text>
                              <Money
                                amount={line.amount * line.quantity}
                                currency={line.currency}
                                unit="minor"
                                locale={locale}
                              />
                            </Text>
                          </Cluster>
                        </li>
                      );
                    })}
                  </ul>
                  <Cluster justify="between" gap="s">
                    <Text data-testid={`review-method-${part.vendorId}`}>
                      {t('storefront.checkout.method.label')}
                      {': '}
                      {t(`storefront.checkout.method.${part.paymentMethod}`)}
                    </Text>
                    {/* One figure per currency, as the total sums them. */}
                    {subtotals.map(subtotal => (
                      <Text key={subtotal.currency} weight="semibold">
                        {t('storefront.review.subtotal')}
                        {': '}
                        <Money
                          amount={subtotal.amount}
                          currency={subtotal.currency}
                          unit="minor"
                          locale={locale}
                        />
                      </Text>
                    ))}
                  </Cluster>
                  {part.paymentMethod === 'cod' && (
                    <Text tone="muted">
                      {t('storefront.review.codNote', { seller })}
                    </Text>
                  )}
                </Stack>
              </Card>
            );
          })}
        </Stack>

        <Cluster justify="between" gap="s">
          {/* The figure the buyer agrees to, summed the way the receipt sums
              it. Place order posts it back, and the checkout sends the buyer
              here again if the re-priced cart no longer adds up to it. */}
          <Stack gap="3xs" data-testid="review-total">
            {totals.map(total => (
              <Text key={total.currency} weight="semibold">
                {t('storefront.cart.total')}
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
          <Cluster gap="s">
            {/* Back to the cart with the tenders still chosen, so editing
                the cart does not cost the buyer their payment choices. */}
            <ButtonLink
              href={localeHref(locale, storePaths.cart(chosen))}
              variant="secondary"
            >
              {t('storefront.review.edit')}
            </ButtonLink>
            <form action={checkout}>
              <input type="hidden" name="locale" value={locale} />
              <input
                type="hidden"
                name="reviewed"
                value={reviewedTotalsOf(totals)}
              />
              {parts.map(part => (
                <input
                  key={part.vendorId}
                  type="hidden"
                  name={tenderField(part.vendorId)}
                  value={part.paymentMethod}
                />
              ))}
              <SubmitButton data-testid="checkout" className="touch-target">
                {t('storefront.review.place')}
              </SubmitButton>
            </form>
          </Cluster>
        </Cluster>
      </Stack>
    </StoreShell>
  );
}
