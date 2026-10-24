import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Button,
  Card,
  Cluster,
  HeadingOne,
  HeadingTwo,
  Overline,
  Stack,
  Text,
} from '@entifix/react-controls/primitives';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { PublishedOffering } from '@r10c/business-ts-marketplace-catalog';
import { loadCategoryTrail } from '@r10c/implementation-catalog-reference-next';
import { loadOfferings } from '@r10c/implementation-marketplace-catalog-next';
import { Breadcrumbs, formatPrice, MediaGallery } from '@r10c/utils-react-ui';
import { cacheLife } from 'next/cache';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { addToCart } from '../cart/cart-actions';
import { MAX_QUANTITY } from '../cart/cart-state';
import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { catalogCrumbs } from '../catalog/catalog-crumbs';
import { emptyPage, runRead } from '../catalog/catalog-reads';
import { OfferingGrid, OfferingGridSkeleton } from '../catalog/offering-grid';
import { readProduct } from '../catalog/product-read';
import { storePaths } from '../routing/paths';
import { storefrontOrigin } from '../seo/page-metadata';
import { jsonLdScript, productJsonLd } from '../seo/product-json-ld';
import { StoreShell } from './store-shell';

/**
 * A product detail page — one published offering, cached on the catalog's
 * lifetime (`CATALOG_CACHE`).
 *
 * The buy box is a plain `<form>` posting to a Server Action. That is why
 * add-to-cart works on a **cached** page: the page itself carries no client
 * state, the action writes the cookie server-side, and the only JavaScript in
 * the buy box is `Button`'s own — which the form does not even need to submit.
 */
async function RelatedOfferings({
  locale,
  categoryId,
  excludeOfferingId,
}: {
  readonly locale: Locale;
  readonly categoryId: string | undefined;
  readonly excludeOfferingId: string;
}) {
  const t = getServerTFor(locale, 'r10c');
  if (!categoryId) return null;

  const page = await runRead(
    PublishedOffering,
    loadOfferings({ categoryIds: [categoryId], pageSize: 4 }),
    emptyPage<PublishedOffering>(),
  );
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

/**
 * Whether `offeringId` names a published offering: a plain boolean, so it can
 * be a cache entry where the offering itself (a class instance) cannot.
 */
async function isPublished(offeringId: string): Promise<boolean> {
  'use cache';
  cacheLife(CATALOG_CACHE);
  return (await readProduct(offeringId)) !== undefined;
}

/**
 * The `404` for an unknown id is the proxy's (`catalogSlugExists`): under
 * partial prerendering this route's static shell is sent before the page
 * runs, and the status goes with it. The check here is what still renders
 * the not-found page — with a `noindex` — when an offering is unpublished
 * between the proxy's answer and this render.
 */
export async function ProductPage({
  locale,
  offeringId,
}: {
  readonly locale: Locale;
  readonly offeringId: string;
}) {
  if (!(await isPublished(offeringId))) notFound();
  return <ProductContent locale={locale} offeringId={offeringId} />;
}

/** The page itself, cached per locale and offering. */
async function ProductContent({
  locale,
  offeringId,
}: {
  readonly locale: Locale;
  readonly offeringId: string;
}) {
  'use cache';
  cacheLife(CATALOG_CACHE);

  const t = getServerTFor(locale, 'r10c');
  const product = await readProduct(offeringId);
  // Unpublished between the check and this render: still a miss.
  if (!product) notFound();
  const { offering, brandName, sellerName } = product;

  // The trail ends at the offering's own category, so it is also the
  // category line below: one vocabulary read, not two (ADR 0062).
  const trail = await runRead(
    ProductCategory,
    loadCategoryTrail(offering.categoryId),
    [],
  );
  const category = trail.at(-1);
  const media = offering.media ?? [];
  const url = `${storefrontOrigin()}${localeHref(locale, storePaths.offering(offering.offeringId))}`;

  return (
    <StoreShell locale={locale}>
      <script
        type="application/ld+json"
        // Escaped by `jsonLdScript`: every string in it is vendor-authored.
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            productJsonLd({ offering, url, brandName, sellerName }),
          ),
        }}
      />
      <Stack gap="xl">
        <Breadcrumbs
          label={t('storefront.breadcrumbs.label')}
          items={catalogCrumbs({
            locale,
            home: t('storefront.breadcrumbs.home'),
            trail,
            leaf: offering.name,
          })}
        />

        <div className="grid grid-cols-1 gap-l sm:grid-cols-2">
          {media.length > 0 ? (
            <MediaGallery
              label={t('storefront.product.gallery')}
              items={media}
            />
          ) : (
            // No pictures: the same square, so the buy box sits where it
            // would with them.
            <div
              className="flex aspect-square items-center justify-center rounded-xl bg-primary/10 text-primary"
              aria-hidden="true"
            >
              <span className="text-step-4 font-semibold">
                {offering.name.charAt(0)}
              </span>
            </div>
          )}

          <Stack gap="s">
            <Stack gap="2xs">
              {brandName ? <Overline>{brandName}</Overline> : null}
              <HeadingOne>{offering.name}</HeadingOne>
              {/* The seller is a projection of their organization (ADR 0061).
                  A miss leaves the line off: an absent line is honest, a raw
                  organization id is not. */}
              {sellerName ? (
                <Text muted data-testid="seller">
                  {t('storefront.product.soldBy', { seller: sellerName })}
                </Text>
              ) : null}
              {offering.description ? (
                <Text muted>{offering.description}</Text>
              ) : null}
            </Stack>

            <Cluster gap="s" justify="between">
              <Text weight="semibold" step={1}>
                {formatPrice(locale, offering.amount, offering.currency)}
              </Text>
              <Text muted>
                {offering.availableHint
                  ? t('storefront.product.available')
                  : t('storefront.product.unavailable')}
              </Text>
            </Cluster>

            {/*
              A real form, not an onClick. It submits without JavaScript, and on
              a cached page there is no other way to reach the server. Named,
              so it is a `form` landmark a buyer — and a test — can tell apart
              from the related cards' own add buttons below.
            */}
            <form
              action={addToCart}
              aria-label={t('storefront.product.buy')}
              className="flex flex-wrap items-end gap-s"
            >
              <input
                type="hidden"
                name="offeringId"
                value={offering.offeringId}
              />
              <input type="hidden" name="locale" value={locale} />
              <label className="text-step--1 flex flex-col gap-3xs text-content-muted">
                {t('storefront.cart.quantity')}
                <input
                  className="w-20 rounded-md border border-border bg-surface px-2xs py-xs text-content"
                  type="number"
                  name="quantity"
                  min="1"
                  max={MAX_QUANTITY}
                  step="1"
                  inputMode="numeric"
                  defaultValue={1}
                />
              </label>
              <Button type="submit" variant="primary" size="lg">
                {t('storefront.product.addToCart')}
              </Button>
            </form>

            <Card>
              <Stack gap="2xs">
                <Text weight="semibold" as="h2">
                  {t('storefront.product.details')}
                </Text>
                <dl className="grid grid-cols-[auto_1fr] gap-x-s gap-y-3xs">
                  {brandName ? (
                    <>
                      <dt className="text-content-muted">
                        {t('storefront.product.brand')}
                      </dt>
                      <dd>{brandName}</dd>
                    </>
                  ) : null}
                  {category ? (
                    <>
                      <dt className="text-content-muted">
                        {t('storefront.product.category')}
                      </dt>
                      <dd>{category.name}</dd>
                    </>
                  ) : null}
                  {/*
                    Still the vendor's own reference, and still worth showing —
                    it is what a buyer quotes back. It is simply no longer the
                    address: two vendors publishing against one specification
                    share this string (ADR 0049).
                  */}
                  {offering.code ? (
                    <>
                      <dt className="text-content-muted">
                        {t('storefront.product.reference')}
                      </dt>
                      <dd>{offering.code}</dd>
                    </>
                  ) : null}
                  {sellerName ? (
                    <>
                      <dt className="text-content-muted">
                        {t('storefront.product.seller')}
                      </dt>
                      <dd>{sellerName}</dd>
                    </>
                  ) : null}
                </dl>
              </Stack>
            </Card>
          </Stack>
        </div>

        <Suspense fallback={<OfferingGridSkeleton count={3} />}>
          <RelatedOfferings
            locale={locale}
            categoryId={category ? String(category.id) : undefined}
            excludeOfferingId={offering.offeringId}
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
