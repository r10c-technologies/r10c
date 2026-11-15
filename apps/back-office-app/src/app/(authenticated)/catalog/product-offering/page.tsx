'use client';

import { productWorkspaceCrud } from '../../../../lib/product-workspace';

/** The offering list, with a price, a picture and the stock of each (#558). */
function ProductOfferingCatalogPage() {
  return <productWorkspaceCrud.ListPage />;
}

export default ProductOfferingCatalogPage;
