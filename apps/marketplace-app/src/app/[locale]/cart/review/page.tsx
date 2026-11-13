import {
  checkoutReviewMetadata,
  CheckoutReviewPage,
  parseTenderChoice,
} from '@r10c/shells-next-marketplace/server';

import { type LocaleRouteProps, requireLocale } from '../../locale-param';

export async function generateMetadata({ params }: LocaleRouteProps) {
  return checkoutReviewMetadata(await requireLocale(params));
}

/**
 * The review step between the cart and the checkout. `searchParams` carries
 * the tender the buyer picked for each seller, from the cart's `GET` form, and
 * `changed` when the checkout sent the buyer back because the cart re-priced
 * differently from what they reviewed.
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
      tenders={parseTenderChoice(query)}
      changed={query?.['changed'] === '1'}
    />
  );
}
