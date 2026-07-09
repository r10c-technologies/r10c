import {
  loadProductsUCFactory,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import { useEntityLinkResolver } from '@r10c/entifix-react-integration';
import { ProductTable } from '@r10c/implementation-product-configuration-management-react';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductListClientPage() {
  const {
    productRest,
    productBrandRest,
    productCategoryRest,
    configurationStore,
  } = useMarketplaceAdminAdapters();

  // Link resolution is wired here, at the page, from the base adapters. This is
  // the seam where last-mile decisions live: a caller could later register
  // cached or state-backed adapters without touching the base adapters or the
  // use-case.
  const entityLinkResolver = useEntityLinkResolver(configurationStore, [
    [ProductBrand, productBrandRest],
    [ProductCategory, productCategoryRest],
  ]);

  const uc = loadProductsUCFactory();
  const ctx = Context.merge(
    Context.merge(configurationStore, productRest),
    entityLinkResolver
  );

  return <ProductTable ctx={ctx} uc={uc} />;
}
