import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, NotFound, useCase } from '@entifix/core';
import {
  defaultSaleRule,
  PRESENTATION_UNIT,
  SaleUnits,
  StockSourceInvalid,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { OfferingCatalogTag } from '../../ports/offering-catalog';
import {
  isNeverPublished,
  NeverPublishedStatuses,
} from '../../values/offering-status';
import { OfferingChanged } from '../offering-flows/offering-flows';
import { SaleUnitFixed } from './sale-unit-failures';

/**
 * What `set-sale-unit` accepts: the unit, and the revision the vendor read
 * (ADR 0079 §4). A seeded offering has no revision until it first moves.
 */
export const SaleUnitPayload = Schema.Struct({
  saleUnit: Schema.Literals(SaleUnits),
  revision: Schema.optional(Schema.Int),
});

export type SaleUnitPayload = typeof SaleUnitPayload.Type;

/**
 * Say what one of this offering is: a piece, a metre, a pound
 * ([ADR 0082](../../../../../../../docs/adr/0082-an-offering-is-sold-in-a-unit-with-a-step.md) §3).
 *
 * **A verb rather than a field the save writes**, because a unit changes what
 * every quantity of the offering means: its step and minimum are reset to one
 * whole unit of the new one in the same write, so `500` can never be read as
 * half a metre after it was written as five hundred pieces.
 *
 * A presentation stays in `UN` ({@link StockSourceInvalid}).
 *
 * Legal only while the offering was **never published**; afterwards it is
 * {@link SaleUnitFixed}. One conditional write on that status and on the
 * revision the vendor read, so a publish or a save landing in between answers
 * {@link OfferingChanged} instead of being overwritten.
 */
@useCase({
  entity: ProductOffering,
  key: 'set-sale-unit',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-offering.useCases.setSaleUnit',
  payload: SaleUnitPayload,
  // The back office's offering page opens this form to ask for the unit; a
  // surface that holds no such form does not offer the verb (entifix #315).
  form: 'sale-unit',
  availableWhen: { member: 'status', in: NeverPublishedStatuses },
  errors: [NotFound, SaleUnitFixed, StockSourceInvalid, OfferingChanged],
})
export class SetSaleUnitUC {
  static run(input: {
    readonly organizationId: string;
    readonly id: EntityId;
    readonly payload: SaleUnitPayload;
  }) {
    return Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      const offerings = yield* factory.for(ProductOffering, {
        organizationId: input.organizationId,
      });
      const offering = yield* offerings.get<ProductOffering>(input.id);
      const id = String(offering.id);
      if (!isNeverPublished(offering.status))
        return yield* new SaleUnitFixed({ id });
      // A presentation is counted (ADR 0082 §7): its factor is per one.
      if (
        offering.stockOfferingId !== undefined &&
        input.payload.saleUnit !== PRESENTATION_UNIT
      )
        return yield* new StockSourceInvalid({ problem: 'notCounted' });
      const read =
        input.payload.revision === undefined
          ? offering.revision
          : input.payload.revision;
      Object.assign(offering, defaultSaleRule(input.payload.saleUnit), {
        revision: read,
      });
      const catalog = yield* OfferingCatalogTag;
      const outcome = yield* catalog.setSaleUnit(
        input.organizationId,
        offering,
      );
      if (outcome === 'changed') return yield* new OfferingChanged({ id });
      // The write moved the revision; answer the one now stored, so a form
      // that reloads from this answer saves against it.
      offering.revision = (read ?? 0) + 1;
      return offering;
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table.
 */
export const SET_SALE_UNIT = permissionForUseCase(SetSaleUnitUC);
