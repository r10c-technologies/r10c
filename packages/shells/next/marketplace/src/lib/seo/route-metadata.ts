import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { getCategoryByCode } from '@r10c/implementation-catalog-reference-next';
import type { Metadata } from 'next';
import { cacheLife } from 'next/cache';

import { CATALOG_CACHE } from '../catalog/catalog-cache';
import { runRead } from '../catalog/catalog-reads';
import { readProduct } from '../catalog/product-read';
import { storePaths } from '../routing/paths';
import { pageMetadata } from './page-metadata';

/**
 * Each storefront route's `generateMetadata`, as the shell states it: the
 * app's route files call these and add nothing.
 *
 * The two that read are `'use cache'`d on the catalog's lifetime: they take
 * plain arguments and return plain objects, which is what a cache entry may
 * hold. The others read nothing but the locale.
 */

export const homeMetadata = (locale: Locale): Metadata =>
  pageMetadata({ locale, path: storePaths.home() });

export const searchMetadata = (locale: Locale): Metadata =>
  pageMetadata({
    locale,
    path: storePaths.search(),
    title: getServerTFor(locale, 'r10c')('storefront.search.heading'),
  });

export const cartMetadata = (locale: Locale): Metadata => ({
  ...pageMetadata({
    locale,
    path: storePaths.cart(),
    title: getServerTFor(locale, 'r10c')('storefront.cart.heading'),
  }),
  // A cart is one visitor's, and has nothing a search engine should list.
  robots: { index: false },
});

export async function categoryMetadata(
  locale: Locale,
  code: string,
): Promise<Metadata> {
  'use cache';
  cacheLife(CATALOG_CACHE);
  const category = await runRead(
    ProductCategory,
    getCategoryByCode(code),
    undefined,
  );
  return pageMetadata({
    locale,
    path: storePaths.category(code),
    title: category?.name,
    description: category?.description,
  });
}

export async function productMetadata(
  locale: Locale,
  offeringId: string,
): Promise<Metadata> {
  'use cache';
  cacheLife(CATALOG_CACHE);
  const product = await readProduct(offeringId);
  return pageMetadata({
    locale,
    path: storePaths.offering(offeringId),
    title: product?.offering.name,
    description: product?.offering.description,
  });
}
