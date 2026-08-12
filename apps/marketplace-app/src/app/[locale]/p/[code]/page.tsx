import { LOCALES } from '@r10c/entifix-ts-i18n/routing';
import {
  loadProducts,
  ProductPage,
} from '@r10c/shells-next-marketplace/server';

import { requireLocale } from '../../locale-param';

export const revalidate = 3600;

/**
 * The main win of the iteration: every product page is HTML on disk before the
 * first visitor asks for it. Add-to-cart still works, because the buy box posts
 * to a Server Action rather than holding client state.
 */
export async function generateStaticParams() {
  const products = await loadProducts({ pageSize: 100 });

  return LOCALES.flatMap(locale =>
    products.items.map(product => ({ locale, code: product.code })),
  );
}

export default async function ProductRoute({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const locale = await requireLocale(params);
  const { code } = await params;

  return <ProductPage locale={locale} code={code} />;
}
