import type { ProductCategory } from '@r10c/business-ts-product-configuration-management';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import { ProductCategoryTable } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductCategoryListClientPage() {
  const { productCategoryRest, configurationStore } =
    useMarketplaceAdminAdapters();

  const uc = loadUCFactory<ProductCategory>();
  const ctx = Context.merge(configurationStore, productCategoryRest);

  return (
    <ProductCategoryTable
      ctx={ctx}
      uc={uc}
      hrefFor={id => `/catalog/product-category/${String(id)}`}
      newHref="/catalog/product-category/new"
    />
  );
}
