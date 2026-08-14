import type { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import { ProductBrandTable } from '@r10c/implementation-product-configuration-management-react';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductBrandListClientPage() {
  const { productBrandRest, configurationStore } =
    useMarketplaceAdminAdapters();
  // Every internal href carries the locale. An unprefixed one still resolves —
  // the middleware redirects it — but the visitor pays a round trip per click.
  const withLocale = useLocaleHref();

  const uc = loadUCFactory<ProductBrand>();
  const ctx = Context.merge(configurationStore, productBrandRest);

  return (
    <ProductBrandTable
      ctx={ctx}
      uc={uc}
      hrefFor={id => withLocale(`/catalog/product-brand/${String(id)}`)}
      newHref={withLocale('/catalog/product-brand/new')}
    />
  );
}
