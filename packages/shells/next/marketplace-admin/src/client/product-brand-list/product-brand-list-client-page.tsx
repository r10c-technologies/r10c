import type { ProductBrand } from '@r10c/business-ts-catalog-reference';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import { ProductBrandTable } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductBrandListClientPage() {
  const { productBrandRest, configurationStore } =
    useMarketplaceAdminAdapters();

  const uc = loadUCFactory<ProductBrand>();
  const ctx = Context.merge(configurationStore, productBrandRest);

  return (
    <ProductBrandTable
      ctx={ctx}
      uc={uc}
      hrefFor={id => `/catalog/product-brand/${String(id)}`}
      newHref="/catalog/product-brand/new"
    />
  );
}
