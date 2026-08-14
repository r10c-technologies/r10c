import type { ProductCategory } from '@r10c/business-ts-catalog-reference';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import { ProductCategoryTable } from '@r10c/implementation-product-configuration-management-react';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductCategoryListClientPage() {
  const { productCategoryRest, configurationStore } =
    useMarketplaceAdminAdapters();
  // Every internal href carries the locale. An unprefixed one still resolves —
  // the middleware redirects it — but the visitor pays a round trip per click.
  const withLocale = useLocaleHref();

  const uc = loadUCFactory<ProductCategory>();
  const ctx = Context.merge(configurationStore, productCategoryRest);

  return (
    <ProductCategoryTable
      ctx={ctx}
      uc={uc}
      hrefFor={id => withLocale(`/catalog/product-category/${String(id)}`)}
      newHref={withLocale('/catalog/product-category/new')}
    />
  );
}
