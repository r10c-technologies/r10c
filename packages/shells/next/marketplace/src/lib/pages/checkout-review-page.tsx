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
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { CONTACT_ERROR_CODES } from '@r10c/business-ts-order-contracts';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';
import { redirect } from 'next/navigation';

import { tendersOffered } from '../cart/checkout-start';
import { CONTACT_FIELDS, refusedState } from '../cart/delivery-contact';
import { DeliveryForm } from '../cart/delivery-form';
import { readPricedCart } from '../cart/priced-cart';
import { reviewedTotalsOf } from '../cart/priced-cart-state';
import { runRead } from '../catalog/catalog-reads';
import { totalsByCurrency } from '../catalog/money';
import { storePaths } from '../routing/paths';
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
 * The buyer chooses how to pay each seller here, in the same form as the
 * contact (ADR 0076 §7), and Place order posts the checkout action with the
 * totals shown here. The action re-prices from the published catalog and, if that no
 * longer matches what was reviewed, sends the buyer back here to look again.
 * Dynamic for the same reason as the cart — it reads the cookie.
 */
export async function CheckoutReviewPage({
  locale,
  changed = false,
  retry = false,
  refused,
}: {
  readonly locale: Locale;
  /**
   * The checkout sent the buyer back: a price moved, or a line stopped being
   * sold, between this page and Place order.
   */
  readonly changed?: boolean;
  /**
   * A retry from a failed start, sent here to state the contact again: Place
   * order then reuses that start's ticket, so it names the same flow.
   */
  readonly retry?: boolean;
  /**
   * The error codes a post made without script was refused with, as the
   * address carried them back (`refusalQuery`); never anything typed.
   */
  readonly refused?: unknown;
}) {
  const t = getServerTFor(locale, 'r10c');
  const tErrors = getServerTFor(locale, 'errors');
  const { parts, offerings, totals, unavailable } = await readPricedCart();
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
                  <Cluster justify="end" gap="s">
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
            <ButtonLink
              href={localeHref(locale, storePaths.cart())}
              variant="secondary"
            >
              {t('storefront.review.edit')}
            </ButtonLink>
          </Cluster>
        </Cluster>

        {/* Where it goes and how to reach the buyer, and Place order with
            it: one form, so a refused contact keeps everything typed. */}
        <Card>
          <DeliveryForm
            locale={locale}
            reviewed={reviewedTotalsOf(totals)}
            sellers={parts.map(part => ({
              vendorId: part.vendorId,
              legend: t('storefront.review.payment.legend', {
                seller:
                  vendors.get(part.vendorId)?.displayName ?? part.vendorId,
              }),
              offered: tendersOffered(vendors.get(part.vendorId)),
            }))}
            retry={retry}
            initial={refusedState(
              refused,
              CONTACT_ERROR_CODES,
              parts.map(part => part.vendorId),
            )}
            labels={{
              legend: t('storefront.review.delivery.legend'),
              intro: t('storefront.review.delivery.intro'),
              optional: t('storefront.review.delivery.optional'),
              chooseMunicipio: t('storefront.review.delivery.chooseMunicipio'),
              place: t('storefront.review.place'),
              fields: Object.fromEntries(
                CONTACT_FIELDS.map(field => [
                  field,
                  t(`storefront.review.delivery.fields.${field}`),
                ]),
              ) as Record<(typeof CONTACT_FIELDS)[number], string>,
              hints: {
                phone: t('storefront.review.delivery.hints.phone'),
                email: t('storefront.review.delivery.hints.email'),
                reference: t('storefront.review.delivery.hints.reference'),
              },
              errors: Object.fromEntries(
                CONTACT_ERROR_CODES.map(code => [code, tErrors(code)]),
              ),
              payment: {
                tender: {
                  card: t('storefront.review.payment.card'),
                  cod: t('storefront.review.payment.cod'),
                },
                only: {
                  card: t('storefront.review.payment.onlyCard'),
                  cod: t('storefront.review.payment.onlyCod'),
                },
                simulated: t('storefront.review.payment.simulated'),
                codHint: t('storefront.review.payment.codHint'),
                required: t('storefront.review.payment.required'),
              },
            }}
          />
        </Card>
      </Stack>
    </StoreShell>
  );
}
