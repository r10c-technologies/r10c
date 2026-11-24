import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, NotFound, useCase } from '@entifix/core';
import {
  PriceTierSchema,
  PriceTiersInvalid,
  priceTiersRefusal,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { ProductOfferingPrice } from '../../entities/product-offering-price';
import { OfferingCatalogTag } from '../../ports/offering-catalog';
import { PriceChanged } from './price-changed';

/**
 * What `set-price-tiers` accepts: every tier the price holds from now on, in
 * order — an empty list removes them — and the revision the vendor read
 * (ADR 0079 §4).
 */
export const PriceTiersPayload = Schema.Struct({
  tiers: Schema.Array(PriceTierSchema),
  revision: Schema.optional(Schema.Int),
});

export type PriceTiersPayload = typeof PriceTiersPayload.Type;

/**
 * Say where a price steps down by quantity
 * ([ADR 0082](../../../../../../../docs/adr/0082-an-offering-is-sold-in-a-unit-with-a-step.md) §8):
 * from each tier's `from` on, the **whole line** is charged its amount.
 *
 * **A verb rather than a field the save writes**, because a tier's `from` is
 * a quantity in the offering's unit and its amount is in the price's
 * currency, and neither lives on the row: the form that asks for them reads
 * both from the records around it, and the save carries the stored tiers
 * across. Checked against the offering's rule as it is now; a publication
 * checks them again, since the unit can still change before it.
 *
 * One conditional write at the revision the vendor read, so a save or
 * another tier change landing in between answers {@link PriceChanged}
 * instead of being overwritten. A seeded price, which has no revision, is
 * written while it still has none.
 */
@useCase({
  entity: ProductOfferingPrice,
  key: 'set-price-tiers',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-offering-price.useCases.setPriceTiers',
  payload: PriceTiersPayload,
  // The back office opens this form to ask for the tiers; a surface that
  // holds no such form does not offer the verb (entifix #315).
  form: 'price-tiers',
  errors: [NotFound, PriceTiersInvalid, PriceChanged],
})
export class SetPriceTiersUC {
  static run(input: {
    readonly organizationId: string;
    readonly id: EntityId;
    readonly payload: PriceTiersPayload;
  }) {
    return Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      const scope = { organizationId: input.organizationId };
      const prices = yield* factory.for(ProductOfferingPrice, scope);
      const offerings = yield* factory.for(ProductOffering, scope);
      const price = yield* prices.get<ProductOfferingPrice>(input.id);
      const offering = yield* offerings.get<ProductOffering>(price.offeringId);
      const tiers = input.payload.tiers.map(({ from, amount }) => ({
        from,
        amount,
      }));
      const refused = priceTiersRefusal(tiers, price, offering);
      if (refused !== undefined) return yield* refused;
      const read =
        input.payload.revision === undefined
          ? price.revision
          : input.payload.revision;
      price.tiers = tiers.length === 0 ? undefined : tiers;
      price.revision = read;
      const catalog = yield* OfferingCatalogTag;
      const outcome = yield* catalog.setPriceTiers(input.organizationId, price);
      if (outcome === 'changed')
        return yield* new PriceChanged({ id: String(price.id) });
      // The write moved the revision; answer the one now stored, so a form
      // that reloads from this answer saves against it.
      price.revision = (read ?? 0) + 1;
      return price;
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table.
 */
export const SET_PRICE_TIERS = permissionForUseCase(SetPriceTiersUC);
