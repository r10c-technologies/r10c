import { OrderConfirmationPage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../../locale-param';

/**
 * Dynamic because the receipt is a cookie.
 *
 * There is nothing to prerender here anyway: the page is the buyer's own order,
 * and the address deliberately identifies no order at all — an order id in a URL
 * is a capability, and the storefront holds no session to check one against.
 */
export const dynamic = 'force-dynamic';

export default async function OrderConfirmationRoute({
  params,
}: LocaleRouteProps) {
  return <OrderConfirmationPage locale={await requireLocale(params)} />;
}
