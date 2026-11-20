import {
  categoryMetadata,
  CategoryPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

/**
 * A blocking route, with no `loading.tsx` (#730), like the buyer's path
 * (#725): a category's listing must render with scripting off, and anything under a
 * Suspense boundary arrives in a hidden container that only a script reveals.
 * Measured on a production build: the first byte waits on cache hits only
 * (the catalog reads are `'use cache'` on `CATALOG_CACHE`), within a few
 * milliseconds of the streamed shell it replaces; a cold entry costs one
 * marketplace-service read.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; category: string }>;
}) {
  const locale = await requireLocale(params);
  return categoryMetadata(locale, (await params).category);
}

/**
 * Facets, sort and page live entirely in the URL and are rendered on the
 * server, so there is no client state and no client fetch, and a listing is
 * shareable. Each distinct listing is a cache entry (`OfferingListing`).
 */
export default async function CategoryRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { category } = await params;

  return (
    <CategoryPage
      locale={locale}
      code={category}
      searchParams={await searchParams}
    />
  );
}
