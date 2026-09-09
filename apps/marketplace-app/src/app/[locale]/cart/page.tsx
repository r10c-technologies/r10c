import { CartPage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../locale-param';

/**
 * Dynamic because it reads `cookies()` — which is exactly what lets the first
 * response already contain the visitor's items instead of an empty cart that
 * corrects itself after hydration.
 */
export const dynamic = 'force-dynamic';

/**
 * `searchParams` carries what a checkout attempt did. It is a query param rather
 * than a cookie or a flash message because the server action redirects here:
 * the result has to survive exactly one navigation and no longer.
 */
export default async function CartRoute({
  params,
  searchParams,
}: LocaleRouteProps & {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const raw = query?.['checkout'];
  const outcome = typeof raw === 'string' ? raw : undefined;

  return (
    <CartPage
      locale={await requireLocale(params)}
      // Narrowed against the closed set rather than passed through: the value
      // reaches a translation key, and an arbitrary query param must not be
      // able to name one.
      outcome={
        outcome === 'placed' ||
        outcome === 'unavailable' ||
        outcome === 'empty' ||
        outcome === 'failed'
          ? outcome
          : undefined
      }
    />
  );
}
