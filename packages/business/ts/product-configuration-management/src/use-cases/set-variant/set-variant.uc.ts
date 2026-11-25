import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, NotFound, useCase } from '@entifix/core';
import {
  normalizedVariant,
  VariantInvalid,
  variantKeyOf,
  type VariantProblem,
  variantShapeRefusal,
  variantSiblingRefusal,
  VariantValue,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import {
  OfferingCatalogTag,
  type VariantSlot,
} from '../../ports/offering-catalog';
import { OfferingChanged } from '../offering-flows/offering-flows';
import { seriesOf, VARIANT_SIBLINGS_PAGE, versionsOf } from './series';

/**
 * What `set-variant` accepts: the values this offering takes on its product's
 * axes, or none — which makes it a product of its own again — and the
 * revision the vendor read (ADR 0079 §4).
 */
export const VariantPayload = Schema.Struct({
  variantValues: Schema.optional(Schema.Array(VariantValue)),
  revision: Schema.optional(Schema.Int),
});

export type VariantPayload = typeof VariantPayload.Type;

/**
 * Make an offering one variant of its product — the black case, the size-40
 * sole — or a product of its own again
 * ([ADR 0085](../../../../../../../docs/adr/0085-a-variant-is-an-offering-of-one-product.md)).
 *
 * The product is the offering's specification **series**, so a revised
 * version keeps its variants together. Every variant of one product varies
 * along the same axes, and no two take one combination: the siblings are read
 * to say which rule broke, and the combination is claimed in the same write as
 * the offering, so two vendors' tabs racing on one colour leave one winner.
 *
 * A presentation draws on its base's stock and a variant holds its own, so an
 * offering is never both.
 */
@useCase({
  entity: ProductOffering,
  key: 'set-variant',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-offering.useCases.setVariant',
  payload: VariantPayload,
  // The back office's offering page opens this form to pick the axes and
  // values; a surface that holds no such form does not offer the verb.
  form: 'variant',
  errors: [NotFound, VariantInvalid, OfferingChanged],
})
export class SetVariantUC {
  static run(input: {
    readonly organizationId: string;
    readonly id: EntityId;
    readonly payload: VariantPayload;
  }) {
    return Effect.gen(function* () {
      const { organizationId } = input;
      const factory = yield* EntityRepositoryFactoryTag;
      const offerings = yield* factory.for(ProductOffering, { organizationId });
      const offering = yield* offerings.get<ProductOffering>(input.id);
      const id = String(offering.id);
      const values = input.payload.variantValues ?? [];
      const refuse = (problem: VariantProblem) =>
        new VariantInvalid({ problem });

      const shape = variantShapeRefusal(values);
      if (shape !== undefined) return yield* refuse(shape);

      let slot: VariantSlot | undefined;
      if (values.length > 0) {
        if (offering.stockOfferingId !== undefined)
          return yield* refuse('presentation');
        const series = yield* seriesOf(
          organizationId,
          offering.specificationId,
        );
        const versions = yield* versionsOf(organizationId, series);
        const page = yield* offerings.load<ProductOffering>({
          filtering: [
            { property: 'specificationId', operator: 'in', values: versions },
          ],
          pageSize: VARIANT_SIBLINGS_PAGE,
        });
        const siblings = page.items
          .filter(one => String(one.id) !== id)
          .flatMap(one =>
            one.variantValues === undefined || one.variantValues.length === 0
              ? []
              : [one.variantValues],
          );
        const sibling = variantSiblingRefusal(values, siblings);
        if (sibling !== undefined) return yield* refuse(sibling);
        slot = { series, key: variantKeyOf(values) };
      }

      const read =
        input.payload.revision === undefined
          ? offering.revision
          : input.payload.revision;
      Object.assign(offering, {
        variantValues:
          values.length > 0 ? normalizedVariant(values) : undefined,
        revision: read,
      });
      const catalog = yield* OfferingCatalogTag;
      const outcome = yield* catalog.setVariant(organizationId, offering, slot);
      if (outcome === 'changed') return yield* new OfferingChanged({ id });
      if (outcome === 'taken') return yield* refuse('combinationTaken');
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
export const SET_VARIANT = permissionForUseCase(SetVariantUC);
