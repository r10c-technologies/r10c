'use client';

import type { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { StockItem } from '@r10c/business-ts-stock-management';
import { productOfferingCrudWith } from '@r10c/shells-next-marketplace-admin';
import {
  stockItemCrud,
  stockMovementCrud,
  useStockAdapters,
} from '@r10c/shells-next-stock';

import { useReader } from './reader';

/** The records of `entity` that point at this offering, by its id. */
const ofOffering = (offering: ProductOffering) => ({
  operator: 'and' as const,
  values: [
    {
      property: 'offeringId' as const,
      operator: 'eq' as const,
      value: String(offering.id),
    },
  ],
});

/**
 * The stock held of an offering, and the movements that moved it — the stock
 * slice's records, rendered by the stock shell's own crud and read through its
 * own adapter (ADR 0077 §3).
 *
 * Absent, not empty, for a reader who may not see stock: a vendor whose
 * organization is not provisioned for it, or a role without the read. A
 * movement is recorded from here with the offering already chosen, and the
 * ledger stays append-only — there is no quantity to type on the item
 * (ADR 0010).
 */
function OfferingStockRegions({
  offering,
}: {
  readonly offering: ProductOffering;
}) {
  const { stockReadable } = useReader();
  if (!stockReadable) return null;
  return (
    <>
      <stockItemCrud.RelatedList
        labelKey="r10c:marketplaceAdmin.offering.regions.stock"
        filtering={ofOffering(offering)}
      />
      <stockMovementCrud.RelatedList
        labelKey="r10c:marketplaceAdmin.offering.regions.movements"
        filtering={ofOffering(offering)}
        prefill={{ offeringId: String(offering.id) }}
      />
    </>
  );
}

/** The offering's page regions this host adds: the stock slice's. */
const regions = (offering: ProductOffering) => [
  <OfferingStockRegions key="stock" offering={offering} />,
];

/**
 * One product workspace (#564): the offering, its status and verbs, its
 * pictures and prices from the catalog slice, and its stock from the stock
 * slice — composed here, the one place allowed to pass one shell's region
 * into another's page (ADR 0077 §2). Built once; the route page and the
 * `master:product-offering:<id>` tab both render it.
 */
export const productWorkspaceCrud = productOfferingCrudWith({
  related: [
    {
      key: 'available',
      labelKey: 'entity:product-offering.related.available',
      target: StockItem as never,
      // The stock shell's own adapter, read under the reader's session: a
      // shell never builds another's (ADR 0077 §2), so the host hands it over.
      repository: { useRepository: () => useStockAdapters().stockItemRest },
      match: 'offeringId',
      member: 'available',
    },
  ],
  regions,
});

/**
 * The same screens for a reader who may not see stock: no "Disponible"
 * column, and so no read the stock service would refuse (#558). A column is
 * fixed when a crud is built, which is why the reader picks between two.
 */
const productWorkspaceCrudWithoutStock = productOfferingCrudWith({ regions });

/** The offering list, with the stock column only for a reader who may see it. */
export function ProductWorkspaceListPage() {
  const { stockReadable } = useReader();
  return stockReadable ? (
    <productWorkspaceCrud.ListPage />
  ) : (
    <productWorkspaceCrudWithoutStock.ListPage />
  );
}
