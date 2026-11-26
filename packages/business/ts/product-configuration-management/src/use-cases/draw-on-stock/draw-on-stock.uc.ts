import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, isFailure, NotFound, useCase } from '@entifix/core';
import {
  isStockFactor,
  PRESENTATION_UNIT,
  StockSourceInvalid,
  type StockSourceProblem,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { OfferingCatalogTag } from '../../ports/offering-catalog';
import { OfferingChanged } from '../offering-flows/offering-flows';

/**
 * What `draw-on-stock` accepts: the base offering and how many of its scaled
 * quantities one of this takes, or neither — which stops the offering drawing
 * on any base — and the revision the vendor read (ADR 0079 §4).
 */
export const StockSourcePayload = Schema.Struct({
  stockOfferingId: Schema.optional(Schema.String),
  stockFactor: Schema.optional(Schema.Number),
  revision: Schema.optional(Schema.Int),
});

export type StockSourcePayload = typeof StockSourcePayload.Type;

/**
 * Sell a presentation — a box, a roll, a dozen — from another offering's
 * stock ([ADR 0082](../../../../../../../docs/adr/0082-an-offering-is-sold-in-a-unit-with-a-step.md) §7).
 *
 * The presentation keeps its own name, price and page, is sold in `UN`, and
 * holds no stock: each one sold reserves `stockFactor` of the base's, so a
 * box and loose units compete through one conditional write. Effective at the
 * next publication, which carries both members and the base's unit in the
 * snapshot; an order already placed copied what it took, so a factor edited
 * later changes no past order.
 *
 * One level, one vendor: the base is in the same tenant catalog, draws on
 * nothing, and is not this offering; and this offering is nobody's base.
 * Publication checks the base again, because nothing here locks it.
 */
@useCase({
  entity: ProductOffering,
  key: 'draw-on-stock',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-offering.useCases.drawOnStock',
  payload: StockSourcePayload,
  // The back office's offering page opens this form to pick the base and the
  // factor; a surface that holds no such form does not offer the verb.
  form: 'stock-source',
  errors: [NotFound, StockSourceInvalid, OfferingChanged],
})
export class SetStockSourceUC {
  static run(input: {
    readonly organizationId: string;
    readonly id: EntityId;
    readonly payload: StockSourcePayload;
  }) {
    return Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      const offerings = yield* factory.for(ProductOffering, {
        organizationId: input.organizationId,
      });
      const offering = yield* offerings.get<ProductOffering>(input.id);
      const id = String(offering.id);
      const { stockOfferingId, stockFactor } = input.payload;
      const refuse = (problem: StockSourceProblem) =>
        new StockSourceInvalid({ problem });

      if (stockOfferingId !== undefined || stockFactor !== undefined) {
        if (offering.saleUnit !== PRESENTATION_UNIT)
          return yield* refuse('notCounted');
        // A variant holds its own stock (ADR 0085).
        if ((offering.variantValues?.length ?? 0) > 0)
          return yield* refuse('isVariant');
        // A kit holds no stock of its own to draw on, nor to be drawn on
        // (ADR 0086).
        if ((offering.kitSize ?? 0) > 0) return yield* refuse('isKit');
        if (!isStockFactor(stockFactor)) return yield* refuse('factor');
        if (stockOfferingId === undefined || stockOfferingId.length === 0)
          return yield* refuse('baseMissing');
        if (stockOfferingId === id) return yield* refuse('self');
        const base = yield* offerings
          .get<ProductOffering>(stockOfferingId)
          .pipe(
            Effect.catchIf(
              failure => isFailure(failure) && failure.category === 'notFound',
              () => Effect.fail(refuse('baseMissing')),
            ),
          );
        if (base.stockOfferingId !== undefined)
          return yield* refuse('baseIsPresentation');
        if ((base.kitSize ?? 0) > 0) return yield* refuse('isKit');
        const drawing = yield* offerings.load<ProductOffering>({
          filtering: [
            { property: 'stockOfferingId', operator: 'eq', value: id },
          ],
          pageSize: 1,
        });
        if (drawing.items.length > 0) return yield* refuse('isBase');
      }

      const read =
        input.payload.revision === undefined
          ? offering.revision
          : input.payload.revision;
      Object.assign(offering, {
        stockOfferingId,
        stockFactor: stockOfferingId === undefined ? undefined : stockFactor,
        revision: read,
      });
      const catalog = yield* OfferingCatalogTag;
      const outcome = yield* catalog.setStockSource(
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
export const DRAW_ON_STOCK = permissionForUseCase(SetStockSourceUC);
