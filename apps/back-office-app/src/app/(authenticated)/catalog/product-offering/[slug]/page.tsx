'use client';

import { productWorkspaceCrud } from '../../../../../lib/product-workspace';

/** One product workspace (#564): the offering with its pictures, prices and stock. */
function ProductOfferingCatalogSinglePage() {
  return <productWorkspaceCrud.SingleViewPage />;
}

export default ProductOfferingCatalogSinglePage;
