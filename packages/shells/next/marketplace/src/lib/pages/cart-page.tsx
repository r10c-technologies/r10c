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
  Stack,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  quantityMaximum,
  SALE_UNIT_SYMBOL_KEY,
  saleUnitScale,
} from '@r10c/business-ts-sales-vocabulary';
import { getOffering } from '@r10c/implementation-marketplace-catalog-next';
import {
  getVendor,
  loadVendors,
} from '@r10c/implementation-marketplace-vendor-next';

import {
  removeFromCart,
  restoreToCart,
  setQuantity,
} from '../cart/cart-actions';
import type { CartNotice } from '../cart/cart-notice';
import type { CheckoutOutcome } from '../cart/checkout-action';
import { readPricedCart } from '../cart/priced-cart';
import { runRead } from '../catalog/catalog-reads';
import { quantityLabel, saleRuleLabel } from '../catalog/price-basis';
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
 * Dynamic by necessity, not by accident: `readPricedCart` reads `cookies()`.
 */
export async function CartPage({
  locale,
  outcome,
  seller,
  notice,
}: {
  readonly locale: Locale;
  /** What a previous checkout attempt did, carried back on the query string. */
  readonly outcome?: CheckoutOutcome;
  /** The seller a `doesNotShip` outcome names, by vendor id. */
  readonly seller?: string;
  /** What the action that redirected here did to a line, for the status region. */
  readonly notice?: CartNotice;
}) {
  const t = getServerTFor(locale, 'r10c');
  const tErrors = getServerTFor(locale, 'errors');
  // i18next 27's `TFunction` is not assignable to a plain translate
  // signature, so the labels get the call they declare.
  const translate = (key: string, values?: Readonly<Record<string, string>>) =>
    values ? t(key, values) : t(key);
  const ruleOf = saleRuleLabel(translate, locale);
  const quantityOf = quantityLabel(translate, locale);
  const { present, parts, offerings, totals, refusals } =
    await readPricedCart();
  const vendors = new Map(
    (
      await runRead(
        PublishedVendor,
        loadVendors(parts.map(part => part.vendorId)),
        [],
      )
    ).map(vendor => [vendor.vendorId, vendor]),
  );

  // The seller a refused checkout names, when nothing left in the cart is
  // theirs any more: read by id, so the address never supplies copy.
  const refusedVendor =
    outcome === 'doesNotShip' && seller !== undefined && !vendors.has(seller)
      ? await runRead(PublishedVendor, getVendor(seller), undefined)
      : undefined;

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
            tone={
              outcome === 'empty' || outcome === 'quantity'
                ? 'warning'
                : 'danger'
            }
            data-testid={`checkout-${outcome}`}
          >
            {outcome === 'doesNotShip'
              ? t('storefront.checkout.doesNotShip', {
                  seller:
                    (seller === undefined
                      ? undefined
                      : (vendors.get(seller) ?? refusedVendor)?.displayName) ??
                    t('storefront.checkout.thisSeller'),
                })
              : t(`storefront.checkout.${outcome}`)}
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
          ) : notice.kind === 'refused' ? (
            // Refused, never rounded (ADR 0082 §3): what the rule is, and
            // that nothing changed — the cart below is as it was.
            <Alert tone="warning" data-testid="cart-refused">
              {t('storefront.cart.refused', { name: noticed.name })}{' '}
              {tErrors(notice.refusal)} {ruleOf(noticed)}
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
                  const refusal = refusals.get(line.offeringId);
                  const rule = ruleOf(offering);
                  const describedBy = `cart-rule-${line.offeringId}`;
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
                            <input type="hidden" name="locale" value={locale} />
                            {/* In the offering's unit and scale; zero
                                removes the line, and anything else it does
                                not sell is refused (ADR 0082 §3). */}
                            <QuantityInput
                              label={t('storefront.cart.quantityOf', {
                                name: offering.name,
                              })}
                              name="quantity"
                              scale={saleUnitScale(offering.saleUnit)}
                              unit={translate(
                                `${SALE_UNIT_SYMBOL_KEY}.${offering.saleUnit}`,
                              )}
                              defaultValue={line.quantity}
                              min={0}
                              step={offering.quantityStep}
                              max={quantityMaximum(offering)}
                              invalid={refusal !== undefined}
                              {...(refusal === undefined && rule === undefined
                                ? {}
                                : { 'aria-describedby': describedBy })}
                              className="touch-target"
                            />
                            <SubmitButton variant="secondary" size="sm">
                              {t('storefront.cart.update')}
                            </SubmitButton>
                          </form>
                          {/* A line the seller's terms no longer sell — a
                              step changed since the add — says why here, and
                              the review stays shut until it is changed. */}
                          {refusal === undefined &&
                          rule === undefined ? null : (
                            <Text
                              id={describedBy}
                              step={-1}
                              tone={refusal === undefined ? 'muted' : 'default'}
                              data-testid={
                                refusal === undefined
                                  ? undefined
                                  : 'cart-line-refused'
                              }
                            >
                              {refusal === undefined
                                ? rule
                                : [tErrors(refusal), rule]
                                    .filter(Boolean)
                                    .join(' ')}
                            </Text>
                          )}
                        </Stack>

                        <Stack gap="3xs">
                          <Text data-testid="cart-line-price">
                            <Money
                              // The preview `lineTotal` computes at the
                              // volume price the quantity reaches, as the
                              // checkout will (ADR 0082 §6, §8).
                              amount={line.lineTotal}
                              currency={line.currency}
                              unit="minor"
                              locale={locale}
                            />
                          </Text>
                          {line.tierFrom === undefined ? null : (
                            <Text
                              step={-1}
                              tone="muted"
                              data-testid="cart-line-tier"
                            >
                              {t('storefront.price.tierApplied', {
                                quantity: quantityOf(
                                  line.tierFrom,
                                  line.saleUnit,
                                ),
                              })}
                            </Text>
                          )}
                        </Stack>

                        <form action={removeFromCart}>
                          <input
                            type="hidden"
                            name="offeringId"
                            value={line.offeringId}
                          />
                          <input type="hidden" name="locale" value={locale} />
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
                    seller's lines and the total, and chooses how to pay each,
                    before anything starts — and so it needs no script (#534,
                    ADR 0076 §7). */}
                {refusals.size > 0 ? (
                  <Alert tone="warning" data-testid="cart-blocked">
                    {t('storefront.cart.blocked')}
                  </Alert>
                ) : (
                  <form
                    action={localeHref(locale, storePaths.checkoutReview())}
                    method="get"
                  >
                    <SubmitButton data-testid="review" className="touch-target">
                      {t('storefront.cart.review')}
                    </SubmitButton>
                  </form>
                )}
              </Cluster>
            </Cluster>
          </Stack>
        )}
      </Stack>
    </StoreShell>
  );
}
