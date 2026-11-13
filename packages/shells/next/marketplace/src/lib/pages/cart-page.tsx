import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Alert,
  ButtonLink,
  Card,
  Cluster,
  EmptyState,
  HeadingOne,
  Money,
  QuantityInput,
  Select,
  Stack,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import { loadVendors } from '@r10c/implementation-marketplace-vendor-next';

import {
  removeFromCart,
  restoreToCart,
  setQuantity,
} from '../cart/cart-actions';
import type { CartNotice } from '../cart/cart-notice';
import { MAX_QUANTITY } from '../cart/cart-state';
import type { CheckoutOutcome } from '../cart/checkout-action';
import { tenderField, tenderOf } from '../cart/checkout-start';
import { readPricedCart } from '../cart/priced-cart';
import { runRead } from '../catalog/catalog-reads';
import { storePaths, type TenderChoice } from '../routing/paths';
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
 * Dynamic by necessity, not by accident: `readPricedCart` reads `cookies()`.
 */
export async function CartPage({
  locale,
  outcome,
  notice,
  tenders = {},
}: {
  readonly locale: Locale;
  /** What a previous checkout attempt did, carried back on the query string. */
  readonly outcome?: CheckoutOutcome;
  /** What the action that redirected here did to a line, for the status region. */
  readonly notice?: CartNotice;
  /** The tenders already chosen, when the buyer came back from the review. */
  readonly tenders?: TenderChoice;
}) {
  const t = getServerTFor(locale, 'r10c');
  const { present, parts, offerings, totals } = await readPricedCart();
  const vendors = new Map(
    (
      await runRead(
        PublishedVendor,
        loadVendors(parts.map(part => part.vendorId)),
        [],
      )
    ).map(vendor => [vendor.vendorId, vendor]),
  );

  // The line a notice names, read like any other: a removed line is no
  // longer in the cookie, so its name is read for the notice alone.
  const noticed =
    notice === undefined
      ? undefined
      : (offerings.get(notice.offeringId) ??
        (await runRead(
          PublishedOffering,
          getOffering(notice.offeringId),
          undefined,
        )));

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.cart.heading')}</HeadingOne>

        {/* Only what the action itself can say: an empty cart, or a start the
            coordinator never accepted. A refused line is the flow's outcome
            and reaches the buyer on the status page the action redirects to,
            never here. */}
        {outcome !== undefined && (
          <Alert
            tone={outcome === 'failed' ? 'danger' : 'warning'}
            data-testid={`checkout-${outcome}`}
          >
            {t(`storefront.checkout.${outcome}`)}
          </Alert>
        )}

        {/* A polite status, so the outcome of an add or a remove is announced
            as well as shown (a3-27). A removal carries its way back: the
            line and its count, posted to an action, with no script (a4-6). */}
        {notice !== undefined && noticed !== undefined ? (
          notice.kind === 'added' ? (
            <Alert tone="success" data-testid="cart-added">
              {t('storefront.cart.added', { name: noticed.name })}
            </Alert>
          ) : (
            <Alert
              tone="info"
              data-testid="cart-removed"
              action={
                <form action={restoreToCart}>
                  <input
                    type="hidden"
                    name="offeringId"
                    value={notice.offeringId}
                  />
                  <input
                    type="hidden"
                    name="quantity"
                    value={notice.quantity}
                  />
                  <input type="hidden" name="locale" value={locale} />
                  {Object.entries(tenders).map(([vendorId, tender]) => (
                    <input
                      key={vendorId}
                      type="hidden"
                      name={tenderField(vendorId)}
                      value={tender}
                    />
                  ))}
                  <SubmitButton variant="secondary" size="sm">
                    {t('storefront.cart.undo')}
                  </SubmitButton>
                </form>
              }
            >
              {t('storefront.cart.removed', { name: noticed.name })}
            </Alert>
          )
        ) : null}

        {present.length === 0 ? (
          <EmptyState
            action={
              <ButtonLink href={localeHref(locale, storePaths.home())}>
                {t('storefront.cart.keepShopping')}
              </ButtonLink>
            }
          >
            {t('storefront.cart.empty')}
          </EmptyState>
        ) : (
          <Stack gap="s">
            {parts.map(part => (
              <Stack
                key={part.vendorId}
                gap="s"
                data-testid={`cart-seller-${part.vendorId}`}
              >
                <Text weight="semibold">
                  {vendors.get(part.vendorId)?.displayName ?? part.vendorId}
                </Text>
                {part.lines.map(line => {
                  const offering = offerings.get(
                    line.offeringId,
                  ) as PublishedOffering;
                  return (
                    <Card key={line.offeringId}>
                      <Cluster justify="between" gap="s">
                        <Stack gap="3xs">
                          <Text weight="semibold">{offering.name}</Text>
                          {/* A form per line, so a quantity changes with no script:
                            the server writes the cookie and renders the totals. */}
                          <form
                            action={setQuantity}
                            className="flex flex-wrap items-end gap-2xs"
                          >
                            <input
                              type="hidden"
                              name="offeringId"
                              value={line.offeringId}
                            />
                            <QuantityInput
                              label={t('storefront.cart.quantityOf', {
                                name: offering.name,
                              })}
                              name="quantity"
                              defaultValue={line.quantity}
                              min={0}
                              max={MAX_QUANTITY}
                              className="touch-target"
                            />
                            <SubmitButton variant="secondary" size="sm">
                              {t('storefront.cart.update')}
                            </SubmitButton>
                          </form>
                        </Stack>

                        <Text data-testid="cart-line-price">
                          <Money
                            amount={offering.amount * line.quantity}
                            currency={offering.currency}
                            unit="minor"
                            locale={locale}
                          />
                        </Text>

                        <form action={removeFromCart}>
                          <input
                            type="hidden"
                            name="offeringId"
                            value={line.offeringId}
                          />
                          <input type="hidden" name="locale" value={locale} />
                          {Object.entries(tenders).map(([vendorId, tender]) => (
                            <input
                              key={vendorId}
                              type="hidden"
                              name={tenderField(vendorId)}
                              value={tender}
                            />
                          ))}
                          <SubmitButton
                            variant="ghost"
                            size="sm"
                            aria-label={t('storefront.cart.removeNamed', {
                              name: offering.name,
                            })}
                          >
                            {t('storefront.cart.remove')}
                          </SubmitButton>
                        </form>
                      </Cluster>
                    </Card>
                  );
                })}
              </Stack>
            ))}

            <Cluster justify="between" gap="s">
              {/* One total per currency, summed the way the receipt sums it,
                  so the figure before checkout is the figure after it. */}
              <Stack gap="3xs" data-testid="cart-total">
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
                  href={localeHref(locale, storePaths.home())}
                  variant="secondary"
                >
                  {t('storefront.cart.keepShopping')}
                </ButtonLink>
                {/* A plain `GET` to the review step, so the buyer sees every
                    seller's lines, tender and the total before anything
                    starts — and so it needs no script (#534). */}
                <form
                  action={localeHref(locale, storePaths.checkoutReview())}
                  method="get"
                  className="flex flex-col gap-2xs"
                >
                  {/* A tender per seller, each its own group: the seller is
                      the legend and the select is named by what it chooses,
                      so a screen reader hears "Forma de pago" inside that
                      seller's group rather than a seller's name alone
                      (a3-26). Cash on delivery is offered only where the
                      seller ships it — a hint from the published vendor
                      record; the checkout's own eligibility step is what
                      refuses. */}
                  {parts.map(part => (
                    <fieldset
                      key={part.vendorId}
                      className="flex flex-col gap-3xs"
                    >
                      <legend className="text-step--1 font-semibold">
                        {vendors.get(part.vendorId)?.displayName ??
                          part.vendorId}
                      </legend>
                      <label
                        htmlFor={tenderField(part.vendorId)}
                        className="text-step--1 text-content-muted"
                      >
                        {t('storefront.checkout.method.label')}
                      </label>
                      <Select
                        id={tenderField(part.vendorId)}
                        name={tenderField(part.vendorId)}
                        defaultValue={tenderOf(tenders[part.vendorId])}
                        data-testid={`tender-${part.vendorId}`}
                      >
                        <option value="card">
                          {t('storefront.checkout.method.card')}
                        </option>
                        {vendors.get(part.vendorId)?.acceptsCod === true ? (
                          <option value="cod">
                            {t('storefront.checkout.method.cod')}
                          </option>
                        ) : null}
                      </Select>
                    </fieldset>
                  ))}
                  <SubmitButton data-testid="review" className="touch-target">
                    {t('storefront.cart.review')}
                  </SubmitButton>
                </form>
              </Cluster>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </StoreShell>
  );
}
