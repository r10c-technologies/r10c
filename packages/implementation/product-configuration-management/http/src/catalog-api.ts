import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  IdempotencyKeyTag,
  verbEndpoint,
} from '@entifix/business';
import {
  DuplicateKey,
  entityKey,
  Invalid,
  makeEntityEnvelope,
  NotFound,
  readEntityEnvelope,
  readWireSelection,
  StaleRevision,
} from '@entifix/core';
import { EventSourceTag } from '@entifix/transactions';
import {
  DeviceModelUniversalNotAlone,
  MediaAltMissing,
  MediaNotHttps,
} from '@r10c/business-ts-catalog-contracts';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  moveSpecificationFor,
  ObsoleteProductSpecificationUC,
  type OfferingTransition,
  preserveOfferingLifecycle,
  preserveSpecificationLifecycle,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  PublishProductOfferingUC,
  refuseSpecificationFits,
  refuseSpecificationMedia,
  refuseUnknownPricePer,
  ReleaseProductSpecificationUC,
  removeSpecificationFor,
  RetireProductSpecificationUC,
  ReviseProductSpecificationUC,
  reviseSpecificationFor,
  type SaleUnitPayload,
  SetSaleUnitUC,
  SpecificationCommandsTag,
  type SpecificationMove,
  SpecificationReleased,
  startSpecificationSeries,
  transitionOfferingFor,
  transitionOfferingSelection,
  UnpublishProductOfferingUC,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Option } from 'effect';

/** The per-organization store refuses a scope with none; the guard always names one. */
const organizationOf = (context: EntityApiContext) =>
  context.organizationId as string;

/** One version moved along its lifecycle, answered with the record. */
const moveOne =
  (move: Exclude<SpecificationMove, 'revise'>) =>
  (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const specification = yield* moveSpecificationFor({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        move,
      });
      return makeEntityEnvelope(
        ProductSpecification,
        specification,
        context.links.record(specification.id),
      );
    });

const release = verbEndpoint(ReleaseProductSpecificationUC, {
  handler: moveOne('release'),
});

const retire = verbEndpoint(RetireProductSpecificationUC, {
  handler: moveOne('retire'),
});

const obsolete = verbEndpoint(ObsoleteProductSpecificationUC, {
  handler: moveOne('obsolete'),
});

/** The next version, in design — answered as the **new** record. */
const revise = verbEndpoint(ReviseProductSpecificationUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const next = yield* reviseSpecificationFor({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
      });
      return makeEntityEnvelope(
        ProductSpecification,
        next,
        context.links.record(next.id),
      );
    }),
});

/**
 * A vendor's specifications. A create's `code` is the next of the
 * organization's counter, drawn in the same unit of work as the record and
 * claimed on its `Idempotency-Key`, so a retried create answers the record it
 * wrote rather than drawing another code. The media rule runs before anything
 * is written, on create and on update.
 *
 * ⚠️ **A version is edited and deleted only in design** (ADR 0079 §1): the
 * update's `prepare` refuses a released one and carries the lifecycle across
 * from what is stored, and the delete is one conditional write. Only the four
 * verbs move `lifecycleStatus`.
 */
export const productSpecificationApi = defineEntityApi(
  ProductSpecification,
  entityKey(ProductSpecification, 'product-specification'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    // The update's half of the media rule and the lifecycle; the create runs
    // them itself.
    prepare: (specification, context) =>
      Effect.as(
        Effect.andThen(
          Effect.andThen(
            refuseSpecificationMedia(specification),
            refuseSpecificationFits(specification),
          ),
          preserveSpecificationLifecycle(
            specification,
            organizationOf(context),
          ),
        ),
        specification,
      ),
    errors: [
      MediaNotHttps,
      MediaAltMissing,
      DeviceModelUniversalNotAlone,
      SpecificationReleased,
    ],
    useCases: [release, revise, retire, obsolete],
    override: {
      create: {
        idempotent: 'unit',
        errors: [
          MediaNotHttps,
          MediaAltMissing,
          DeviceModelUniversalNotAlone,
          Invalid,
          DuplicateKey,
          StaleRevision,
        ],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const specification = yield* readEntityEnvelope(
              ProductSpecification,
              request.payload,
            );
            yield* refuseSpecificationMedia(specification);
            yield* refuseSpecificationFits(specification);
            const commands = yield* SpecificationCommandsTag;
            const created = yield* commands.create(
              organizationOf(context),
              startSpecificationSeries(specification),
              Option.getOrUndefined(
                yield* Effect.serviceOption(IdempotencyKeyTag),
              ),
            );
            return makeEntityEnvelope(
              ProductSpecification,
              created,
              context.links.record(created.id),
            );
          }),
      },
      // A conditional delete: a repeat answers `404`, never a second effect.
      delete: {
        errors: [NotFound, SpecificationReleased],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const id = yield* removeSpecificationFor({
              organizationId: organizationOf(context),
              id: request.params?.id as string,
            });
            return {
              meta: {
                type: 'entity',
                entity: 'product-specification',
                links: context.links.collection(),
              },
              data: { id },
            };
          }),
      },
    },
  },
);

/** One offering moved, answered with the record and the links the caller may follow. */
const transitionOne =
  (transition: OfferingTransition) =>
  (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const offering = yield* transitionOfferingFor({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        transition,
        source: yield* EventSourceTag,
      });
      return makeEntityEnvelope(
        ProductOffering,
        offering,
        context.links.record(offering.id),
      );
    });

/**
 * The same verb over a selection (#216), under **the same permission**: a
 * separate grant would be a role that could publish one offering but not
 * twenty. The wire form is arrays, because a `Set` does not survive JSON, and
 * each row answers its own outcome — one unpriceable offering does not stop
 * the other nineteen.
 */
const transitionSelected =
  (transition: OfferingTransition) =>
  (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const selection = readWireSelection<ProductOffering>(
        (request.payload as { readonly selection?: unknown }).selection,
      );
      if (!selection) {
        return yield* new InvalidBody({
          reason:
            'a bulk request carries a `selection` in `ids` or `matching` mode',
        });
      }
      const outcomes = yield* transitionOfferingSelection({
        organizationId: organizationOf(context),
        selection,
        transition,
        source: yield* EventSourceTag,
      });
      return {
        meta: { type: 'bulkOutcome', entity: 'product-offering' },
        data: outcomes,
      };
    });

const publish = verbEndpoint(PublishProductOfferingUC, {
  handler: transitionOne('publish'),
  bulk: transitionSelected('publish'),
});

/**
 * `POST /api/product-offering/:id/set-sale-unit` — the vendor says what one of
 * the offering is, while it was never published (ADR 0082 §3). Answered with
 * the record at its new revision, step and minimum reset to one whole unit.
 */
const setSaleUnit = verbEndpoint(SetSaleUnitUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const offering = yield* SetSaleUnitUC.run({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        payload: request.payload as SaleUnitPayload,
      });
      return makeEntityEnvelope(
        ProductOffering,
        offering,
        context.links.record(offering.id),
      );
    }),
});

const unpublish = verbEndpoint(UnpublishProductOfferingUC, {
  handler: transitionOne('unpublish'),
  bulk: transitionSelected('unpublish'),
});

/**
 * A vendor's offerings. ⚠️ `status` is **server-owned** (ADR 0047): a save
 * carries the stored status across and a new offering starts `draft`, so only
 * the two verbs move it — each checking the price and the specification, and
 * announcing what it did.
 */
export const productOfferingApi = defineEntityApi(
  ProductOffering,
  entityKey(ProductOffering, 'product-offering'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: (offering, context) =>
      preserveOfferingLifecycle(offering, organizationOf(context)),
    useCases: [publish, unpublish, setSaleUnit],
  },
);

/**
 * A vendor's prices. A price is for one, a hundred or a thousand units
 * (ADR 0082 §5); a save naming another quantity is refused `pricePerInvalid`.
 */
export const productOfferingPriceApi = defineEntityApi(
  ProductOfferingPrice,
  entityKey(ProductOfferingPrice, 'product-offering-price'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: price => refuseUnknownPricePer(price),
  },
);
