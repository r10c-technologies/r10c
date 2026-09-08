import {
  Button,
  Card,
  Cluster,
  HeadingOne,
  HeadingTwo,
  Overline,
  Stack,
  Text,
} from '@r10c/entifix-react-controls/primitives';
import { getServerTFor } from '@r10c/entifix-ts-i18n';
import type { Locale } from '@r10c/entifix-ts-i18n/routing';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { addToCart } from '../cart/cart-actions';
import { formatMoney } from '../catalog/money';
import { OfferingGrid, OfferingGridSkeleton } from '../catalog/offering-grid';
import {
  getBrand,
  getCategory,
  getOffering,
  loadOfferings,
} from '../catalog/queries';
import { StoreShell } from './store-shell';

/**
 * A product detail page — one published offering, revalidated on the interval
 * the route declares.
 *
 * The buy box is a plain `<form>` posting to a Server Action. That is why
 * add-to-cart works on a **cached** page: the page itself carries no client
 * state, the action writes the cookie server-side, and the only JavaScript in
 * the buy box is `Button`'s own — which the form does not even need to submit.
 */
async function RelatedOfferings({
  locale,
  categoryCode,
  excludeOfferingId,
}: {
  readonly locale: Locale;
  readonly categoryCode: string | undefined;
  readonly excludeOfferingId: string;
}) {
  const t = getServerTFor(locale, 'shell');
  if (!categoryCode) return null;

  const page = await loadOfferings({ category: categoryCode, pageSize: 4 });
  const related = page.items.filter(
    item => item.offeringId !== excludeOfferingId,
  );

  if (related.length === 0) return null;

  return (
    <Stack gap="s">
      <HeadingTwo>{t('storefront.product.related')}</HeadingTwo>
      <OfferingGrid
        locale={locale}
        offerings={related}
        emptyLabel={t('storefront.category.empty')}
      />
    </Stack>
  );
}

export async function ProductPage({
  locale,
  offeringId,
}: {
  readonly locale: Locale;
  readonly offeringId: string;
}) {
  const t = getServerTFor(locale, 'shell');
  const offering = await getOffering(offeringId);
  if (!offering) notFound();

  // Resolved through the owning domain's read path, not a storage-layer join:
  // both ids point into `catalog-reference`, another slice's store (ADR 0022).
  const [brand, category] = await Promise.all([
    getBrand(offering.brandId),
    getCategory(offering.categoryId),
  ]);

  return (
    <StoreShell locale={locale}>
      <Stack gap="xl">
        <div className="grid grid-cols-1 gap-l sm:grid-cols-2">
          <div
            className="flex aspect-square items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <span className="text-step-4 font-semibold">
              {offering.name.charAt(0)}
            </span>
          </div>

          <Stack gap="s">
            <Stack gap="2xs">
              <Overline>
                {brand?.name ?? t('storefront.product.brand')}
              </Overline>
              <HeadingOne>{offering.name}</HeadingOne>
              <Text muted>{offering.description}</Text>
            </Stack>

            <Cluster gap="s" justify="between">
              <Text weight="semibold" step={1}>
                {formatMoney(locale, offering.amount, offering.currency)}
              </Text>
              <Text muted>
                {offering.availableHint
                  ? t('storefront.product.available')
                  : t('storefront.product.unavailable')}
              </Text>
            </Cluster>

            <Card>
              <Stack gap="2xs">
                {/*
                  Still the vendor's own reference, and still worth showing —
                  it is what a buyer quotes back. It is simply no longer the
                  address: two vendors publishing against one specification
                  share this string (ADR 0049).
                */}
                {offering.code ? (
                  <Text muted>
                    {t('storefront.product.reference')}
                    {': '}
                    {offering.code}
                  </Text>
                ) : null}
                {category ? (
                  <Text muted>
                    {t('storefront.product.category')}
                    {': '}
                    {category.name}
                  </Text>
                ) : null}
              </Stack>
            </Card>

            {/*
              A real form, not an onClick. It submits without JavaScript, and on
              a cached page there is no other way to reach the server.
            */}
            <form action={addToCart}>
              <input
                type="hidden"
                name="offeringId"
                value={offering.offeringId}
              />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="primary" size="lg">
                {t('storefront.product.addToCart')}
              </Button>
            </form>
          </Stack>
        </div>

        <Suspense fallback={<OfferingGridSkeleton count={3} />}>
          <RelatedOfferings
            locale={locale}
            categoryCode={category?.code}
            excludeOfferingId={offering.offeringId}
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
