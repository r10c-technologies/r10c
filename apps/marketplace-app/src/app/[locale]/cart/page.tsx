import {
  cartMetadata,
  CartPage,
  parseCartNotice,
} from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../locale-param';

/**
 * A blocking route, with no `loading.tsx` (#725). Anything under a Suspense
 * boundary — and a `loading.tsx` is one, for every route below it — arrives in
 * a hidden container that an inline script reveals, so with scripting off the
 * page would be blank. This route is on the buyer's path to an order, which
 * must work without JavaScript, so it renders whole before its first byte.
 */
export const instant = false;

export async function generateMetadata({ params }: LocaleRouteProps) {
  return cartMetadata(await requireLocale(params));
}

/**
 * `searchParams` carries what a checkout attempt, or a cart action, did. It is a query param rather
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
        outcome === 'empty' ||
        outcome === 'failed' ||
        outcome === 'doesNotShip'
          ? outcome
          : undefined
      }
      // An id only, which the page resolves to a name itself — never copy
      // from the address.
      seller={
        typeof query?.['seller'] === 'string' ? query['seller'] : undefined
      }
      notice={parseCartNotice(query)}
    />
  );
}
