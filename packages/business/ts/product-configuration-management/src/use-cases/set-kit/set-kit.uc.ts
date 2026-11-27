import { permissionForUseCase } from '@entifix/authz';
import { EntityRepositoryFactoryTag } from '@entifix/business';
import { type EntityId, isFailure, NotFound, useCase } from '@entifix/core';
import {
  KitInvalid,
  type KitProblem,
  kitShapeRefusal,
  PRESENTATION_UNIT,
} from '@r10c/business-ts-sales-vocabulary';
import { Effect, Schema } from 'effect';

import { ProductOffering } from '../../entities/product-offering';
import { OfferingCatalogTag } from '../../ports/offering-catalog';
import { OfferingChanged } from '../offering-flows/offering-flows';

/**
 * What `set-kit` accepts: the components and how many of each one kit holds,
 * or none — which makes the offering a plain one again — and the revision the
 * vendor read (ADR 0079 §4).
 */
export const KitPayload = Schema.Struct({
  components: Schema.Array(
    Schema.Struct({ offeringId: Schema.String, quantity: Schema.Number }),
  ),
  revision: Schema.optional(Schema.Int),
});

export type KitPayload = typeof KitPayload.Type;

/** The most kits a vendor's catalog is checked against for a component. */
const KITS_PAGE = 500;

/**
 * Sell several of a vendor's offerings together at one price
 * ([ADR 0086](../../../../../../../docs/adr/0086-a-kit-sells-several-offerings-at-one-price.md)).
 *
 * The kit keeps its own name, price and page, is sold in `UN` and holds no
 * stock: each one sold holds every component's stock, so a kit and a loose
 * component compete for one balance. Effective at the next publication, which
 * resolves what one kit takes from each component; an order already placed
 * copied what it took.
 *
 * One level, one stock rule each: a component is in the same tenant catalog,
 * sold in `UN` and no kit; the kit is no variant, no presentation, nobody's
 * stock base and no other kit's component. Publication checks the components
 * again, because nothing here locks them.
 */
@useCase({
  entity: ProductOffering,
  key: 'set-kit',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:product-offering.useCases.setKit',
  payload: KitPayload,
  // The back office's offering page opens this form to pick the components;
  // a surface that holds no such form does not offer the verb.
  form: 'kit',
  errors: [NotFound, KitInvalid, OfferingChanged],
})
export class SetKitUC {
  static run(input: {
    readonly organizationId: string;
    readonly id: EntityId;
    readonly payload: KitPayload;
  }) {
    return Effect.gen(function* () {
      const factory = yield* EntityRepositoryFactoryTag;
      const offerings = yield* factory.for(ProductOffering, {
        organizationId: input.organizationId,
      });
      const offering = yield* offerings.get<ProductOffering>(input.id);
      const id = String(offering.id);
      const components = input.payload.components.map(
        ({ offeringId, quantity }) => ({ offeringId, quantity }),
      );
      const refuse = (problem: KitProblem) => new KitInvalid({ problem });

      if (components.length > 0) {
        const shape = kitShapeRefusal(id, components);
        if (shape !== undefined) return yield* refuse(shape);
        if (offering.saleUnit !== PRESENTATION_UNIT)
          return yield* refuse('notCounted');
        // A variant holds its own stock (ADR 0085), and a presentation
        // another's (ADR 0082 §7): a kit holds none, so it is neither.
        if ((offering.variantValues?.length ?? 0) > 0)
          return yield* refuse('isVariant');
        if (offering.stockOfferingId !== undefined)
          return yield* refuse('isPresentation');
        for (const component of components) {
          const held = yield* offerings
            .get<ProductOffering>(component.offeringId)
            .pipe(
              Effect.catchIf(
                failure =>
                  isFailure(failure) && failure.category === 'notFound',
                () => Effect.fail(refuse('componentMissing')),
              ),
            );
          if ((held.kitSize ?? 0) > 0) return yield* refuse('componentIsKit');
          if (held.saleUnit !== PRESENTATION_UNIT)
            return yield* refuse('componentNotCounted');
        }
        const drawing = yield* offerings.load<ProductOffering>({
          filtering: [
            { property: 'stockOfferingId', operator: 'eq', value: id },
          ],
          pageSize: 1,
        });
        if (drawing.items.length > 0) return yield* refuse('isBase');
        const kits = yield* offerings.load<ProductOffering>({
          filtering: [{ property: 'kitSize', operator: 'gt', value: 0 }],
          pageSize: KITS_PAGE,
        });
        const isComponent = kits.items.some(
          kit =>
            String(kit.id) !== id &&
            (kit.kitComponents ?? []).some(
              component => component.offeringId === id,
            ),
        );
        if (isComponent) return yield* refuse('isComponent');
      }

      const read =
        input.payload.revision === undefined
          ? offering.revision
          : input.payload.revision;
      Object.assign(offering, {
        kitComponents: components.length === 0 ? undefined : components,
        kitSize: components.length === 0 ? undefined : components.length,
        revision: read,
      });
      const catalog = yield* OfferingCatalogTag;
      const outcome = yield* catalog.setKit(input.organizationId, offering);
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
export const SET_KIT = permissionForUseCase(SetKitUC);
