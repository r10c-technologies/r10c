import { cartMetadata, CartPage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../locale-param';

export async function generateMetadata({ params }: LocaleRouteProps) {
  return cartMetadata(await requireLocale(params));
}

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
