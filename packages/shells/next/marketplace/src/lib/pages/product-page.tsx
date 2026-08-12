import {
  Button,
  Card,
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
import { ProductGrid, ProductGridSkeleton } from '../catalog/product-grid';
import {
  getBrand,
  getCategory,
  getProduct,
  loadProducts,
} from '../catalog/queries';
import { StoreShell } from './store-shell';

/**
 * A product detail page — prerendered per product per locale.
 *
 * The buy box is a plain `<form>` posting to a Server Action. That is why
 * add-to-cart works on a **static** page: the page itself carries no client
 * state, the action writes the cookie server-side, and the only JavaScript in
 * the buy box is `Button`'s own — which the form does not even need to submit.
 */
async function RelatedProducts({
  locale,
  categoryCode,
  excludeCode,
}: {
  readonly locale: Locale;
  readonly categoryCode: string | undefined;
  readonly excludeCode: string;
}) {
  const t = getServerTFor(locale, 'shell');
  if (!categoryCode) return null;

  const page = await loadProducts({ category: categoryCode, pageSize: 4 });
  const related = page.items.filter(item => item.code !== excludeCode);

  if (related.length === 0) return null;

  return (
    <Stack gap="s">
      <HeadingTwo>{t('storefront.product.related')}</HeadingTwo>
      <ProductGrid
        locale={locale}
        products={related}
        emptyLabel={t('storefront.category.empty')}
      />
    </Stack>
  );
}

export async function ProductPage({
  locale,
  code,
}: {
  readonly locale: Locale;
  readonly code: string;
}) {
  const t = getServerTFor(locale, 'shell');
  const product = await getProduct(code);
  if (!product) notFound();

  // Resolved through the owning domain's read path, not a storage-layer join:
  // both ids point into `catalog-reference`, another slice's store (ADR 0022).
  const [brand, category] = await Promise.all([
    getBrand(product.brandId),
    getCategory(product.categoryId),
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
              {product.name.charAt(0)}
            </span>
          </div>

          <Stack gap="s">
            <Stack gap="2xs">
              <Overline>
                {brand?.name ?? t('storefront.product.brand')}
              </Overline>
              <HeadingOne>{product.name}</HeadingOne>
              <Text muted>{product.description}</Text>
            </Stack>

            <Card>
              <Stack gap="2xs">
                <Text muted>
                  {t('storefront.product.reference')}
                  {': '}
                  {product.code}
                </Text>
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
              a prerendered page there is no other way to reach the server.
            */}
            <form action={addToCart}>
              <input type="hidden" name="code" value={product.code} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="primary" size="lg">
                {t('storefront.product.addToCart')}
              </Button>
            </form>
          </Stack>
        </div>

        <Suspense fallback={<ProductGridSkeleton count={3} />}>
          <RelatedProducts
            locale={locale}
            categoryCode={category?.code}
            excludeCode={product.code}
          />
        </Suspense>
      </Stack>
    </StoreShell>
  );
}
