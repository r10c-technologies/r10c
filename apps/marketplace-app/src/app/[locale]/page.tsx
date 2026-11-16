import { homeMetadata, HomePage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from './locale-param';

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
