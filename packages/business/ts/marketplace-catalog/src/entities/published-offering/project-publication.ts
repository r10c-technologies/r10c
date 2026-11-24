import type { CatalogPublication } from '@r10c/business-ts-catalog-contracts';
import { amountPerThousand } from '@r10c/business-ts-sales-vocabulary';

import { PublishedOffering } from './published-offering.entity';

/**
 * The record a publication projects to, stamped `at`: every member the
 * snapshot carries, keyed on the offering so republishing replaces rather than
 * accumulates, and the derived {@link PublishedOffering.amountPerThousand} a
 * list orders prices by (ADR 0082 §5).
 *
 * One function for every writer of the projection, so the key a sort reads is
 * derived the same way whichever store holds it.
 */
export const projectPublication = (
  publication: CatalogPublication,
  at: Date,
): PublishedOffering => {
  const projected = new PublishedOffering(
    publication.offeringId,
    publication.vendorId,
    publication.name,
  );
  projected.id = publication.offeringId;
  projected.amount = publication.amount;
  projected.currency = publication.currency;
  projected.pricePer = publication.pricePer;
  projected.tiers = publication.tiers;
  projected.amountPerThousand = amountPerThousand(publication);
  projected.saleUnit = publication.saleUnit;
  projected.quantityStep = publication.quantityStep;
  projected.quantityMinimum = publication.quantityMinimum;
  projected.availableHint = publication.availableHint;
  projected.publishedAt = at;
  projected.specificationId = publication.specificationId;
  projected.specificationVersion = publication.specificationVersion;
  projected.code = publication.code;
  projected.description = publication.description;
  projected.brandId = publication.brandId;
  projected.categoryId = publication.categoryId;
  projected.media = publication.media;
  projected.fitsDeviceModelIds = publication.fitsDeviceModelIds;
  return projected;
};
