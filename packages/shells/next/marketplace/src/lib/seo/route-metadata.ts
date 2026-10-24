import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { getCategoryByCode } from '@r10c/implementation-catalog-reference-next';
import type { Metadata } from 'next';

import { runRead } from '../catalog/catalog-reads';
import { readProduct } from '../catalog/product-read';
import { storePaths } from '../routing/paths';
import { pageMetadata } from './page-metadata';

/**
 * Each storefront route's `generateMetadata`, as the shell states it: the
 * app's route files call these and add nothing.
 *
 * The reads are the pages' own. The product read is React-`cache`d
 * (`readProduct`), so a product page and its metadata share one request; a
 * category resolves its code the way its page does.
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
  const product = await readProduct(offeringId);
  return pageMetadata({
    locale,
    path: storePaths.offering(offeringId),
    title: product?.offering.name,
    description: product?.offering.description,
  });
}
