import { OrderAccessPage } from '@r10c/shells-next-marketplace/server';
import type { Metadata } from 'next';

import { requireLocale } from '../../locale-param';

/**
 * A blocking route, with no `loading.tsx` (#725). Anything under a Suspense
 * boundary — and a `loading.tsx` is one, for every route below it — arrives in
 * a hidden container that an inline script reveals, so with scripting off the
 * page would be blank. This route is on the buyer's path to an order, which
 * must work without JavaScript, so it renders whole before its first byte.
 */
export const instant = false;

/**
 * Where a mailed one-time access link lands. The token is read from the query
 * string into the page's form and spent only by its post; `failed` is the one
 * navigation back from a refused redemption (ADR 0076 §6).
 */
export const metadata: Metadata = {
  referrer: 'strict-origin',
  robots: { index: false, follow: false },
};

export default async function OrderAccessRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const token = query?.['token'];

  return (
    <OrderAccessPage
      locale={await requireLocale(params)}
      {...(typeof token === 'string' ? { token } : {})}
      failed={query?.['failed'] === '1'}
    />
  );
}
