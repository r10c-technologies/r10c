import { CartPage } from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../locale-param';

/**
 * Dynamic because it reads `cookies()` — which is exactly what lets the first
 * response already contain the visitor's items instead of an empty cart that
 * corrects itself after hydration.
 */
export const dynamic = 'force-dynamic';

export default async function CartRoute({ params }: LocaleRouteProps) {
  return <CartPage locale={await requireLocale(params)} />;
}
