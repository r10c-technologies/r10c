import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { loadUCFactory } from '@r10c/entifix-ts-business';
import { ProductTable } from '@r10c/implementation-product-configuration-management-react';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Context } from 'effect';

import { useMarketplaceAdminAdapters } from '../marketplace-admin-context';

export function ProductListClientPage() {
  const { productRest, configurationStore } = useMarketplaceAdminAdapters();
  // Every internal href carries the locale. An unprefixed one still resolves —
  // the middleware redirects it — but the visitor pays a round trip per click.
  const withLocale = useLocaleHref();

  // No link resolver here any more. Brand and category are plain ids on
  // `ProductSpecification`: their entities live in `catalog-reference`, a
  // platform-plane store owned by another slice, so resolving them at the
  // storage layer is exactly the cross-store coupling ADR 0022 removed. A list
  // shows the ids; a screen that needs names asks the owning domain for them.
  const uc = loadUCFactory<ProductSpecification>();
  const ctx = Context.merge(configurationStore, productRest);

  return (
    <ProductTable
      ctx={ctx}
      uc={uc}
      hrefFor={id => withLocale(`/catalog/product/${String(id)}`)}
      newHref={withLocale('/catalog/product/new')}
    />
  );
}
