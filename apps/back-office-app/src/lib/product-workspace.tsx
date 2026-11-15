'use client';

import type { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { productOfferingCrudWith } from '@r10c/shells-next-marketplace-admin';
import { stockItemCrud, stockMovementCrud } from '@r10c/shells-next-stock';

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

/**
 * One product workspace (#564): the offering, its status and verbs, its
 * pictures and prices from the catalog slice, and its stock from the stock
 * slice — composed here, the one place allowed to pass one shell's region
 * into another's page (ADR 0077 §2). Built once; the route page and the
 * `master:product-offering:<id>` tab both render it.
 */
export const productWorkspaceCrud = productOfferingCrudWith({
  regions: offering => [
    <OfferingStockRegions key="stock" offering={offering} />,
  ],
});
