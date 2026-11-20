import { homeMetadata, HomePage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from './locale-param';

/**
 * A blocking route, with no `loading.tsx` (#730), like the buyer's path
 * (#725): the home page's newest and featured strips must render with scripting off, and anything under a
 * Suspense boundary arrives in a hidden container that only a script reveals.
 * Measured on a production build: the first byte waits on cache hits only
 * (the catalog reads are `'use cache'` on `CATALOG_CACHE`), within a few
 * milliseconds of the streamed shell it replaces; a cold entry costs one
 * marketplace-service read.
 */
export const instant = false;

export async function generateMetadata({ params }: LocaleRouteProps) {
  return homeMetadata(await requireLocale(params));
}

/**
 * The query is handed down unawaited: only the add notice reads it (#574),
 * inside its own `Suspense` hole, so home itself stays prerendered.
 */
export default async function Index({
  params,
  searchParams,
}: LocaleRouteProps & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <HomePage
      locale={await requireLocale(params)}
      searchParams={searchParams}
    />
  );
}
