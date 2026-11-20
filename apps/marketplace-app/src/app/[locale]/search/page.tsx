import {
  searchMetadata,
  SearchPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../locale-param';

/**
 * A blocking route, with no `loading.tsx` (#730), like the buyer's path
 * (#725): a search's listing must render with scripting off, and anything under a
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
  params: Promise<{ locale: string }>;
}) {
  return searchMetadata(await requireLocale(params));
}

/**
 * Dynamic, and correctly so: the answer is the query string — the term, the
 * facets, the sort and the page.
 */
export default async function SearchRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);

  return <SearchPage locale={locale} searchParams={await searchParams} />;
}
