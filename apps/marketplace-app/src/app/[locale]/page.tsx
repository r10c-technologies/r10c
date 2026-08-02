import { HomePage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from './locale-param';

/**
 * Prerendered, one copy per locale, refreshed hourly. Nothing here reads the
 * request, which is the only reason that is possible.
 */
export const revalidate = 3600;

export default async function Index({ params }: LocaleRouteProps) {
  return <HomePage locale={await requireLocale(params)} />;
}
