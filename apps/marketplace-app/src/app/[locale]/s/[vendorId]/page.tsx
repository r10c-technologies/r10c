import {
  sellerMetadata,
  SellerPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

/**
 * A seller's own page (#675). A blocking route, with no `loading.tsx`, like
 * the product page (#725): it is a link a seller sends to a customer, and the
 * customer's phone may open it with scripting off, so it renders whole
 * before its first byte. An unknown vendor id is the proxy's `404`.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; vendorId: string }>;
}) {
  const locale = await requireLocale(params);
  return sellerMetadata(locale, decodeURIComponent((await params).vendorId));
}

export default async function SellerRoute({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; vendorId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { vendorId } = await params;

  return (
    <SellerPage
      locale={locale}
      vendorId={decodeURIComponent(vendorId)}
      searchParams={await searchParams}
    />
  );
}
