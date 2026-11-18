import {
  checkoutReviewMetadata,
  CheckoutReviewPage,
} from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../../locale-param';

export async function generateMetadata({ params }: LocaleRouteProps) {
  return checkoutReviewMetadata(await requireLocale(params));
}

/**
 * The review step between the cart and the checkout, where the buyer chooses
 * how to pay each seller (ADR 0076 §7). `searchParams` carries `changed` when
 * the checkout sent the buyer back because the cart re-priced differently from
 * what they reviewed, and `retry` when a failed start sent them back to state
 * their contact again under the same ticket.
 */
export default async function CheckoutReviewRoute({
  params,
  searchParams,
}: LocaleRouteProps & {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const query = await searchParams;
  return (
    <CheckoutReviewPage
      locale={await requireLocale(params)}
      changed={query?.['changed'] === '1'}
      retry={query?.['retry'] === '1'}
    />
  );
}
