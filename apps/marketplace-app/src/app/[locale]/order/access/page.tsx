import { OrderAccessPage } from '@r10c/shells-next-marketplace/server';
import type { Metadata } from 'next';

import { requireLocale } from '../../locale-param';

/**
 * Where a mailed one-time access link lands. The token is read from the query
 * string into the page's form and spent only by its post; `failed` is the one
 * navigation back from a refused redemption (ADR 0076 §6).
 */
export const metadata: Metadata = {
  referrer: 'no-referrer',
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
