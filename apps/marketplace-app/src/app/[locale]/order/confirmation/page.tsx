import {
  isCancelOutcome,
  OrderConfirmationPage,
} from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../../locale-param';

/**
 * `searchParams` carries what a cancel attempt did. A query param rather than a
 * cookie, for the reason the cart's does: the server action redirects here, and
 * the result has to survive exactly one navigation and no longer.
 *
 * A *successful* cancel is not read from here — it is written into the receipt
 * cookie, which is the page's only state. This param exists for the failure,
 * where nothing about the order changed and there is nothing else to say so.
 */
export default async function OrderConfirmationRoute({
  params,
  searchParams,
}: LocaleRouteProps & {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const query = await searchParams;
  const raw = query?.['cancel'];
  const outcome = typeof raw === 'string' ? raw : undefined;

  return (
    <OrderConfirmationPage
      locale={await requireLocale(params)}
      // Narrowed against the closed set rather than passed through: the value
      // decides a translation key, and an arbitrary query param must not be
      // able to name one.
      outcome={isCancelOutcome(outcome) ? outcome : undefined}
    />
  );
}
