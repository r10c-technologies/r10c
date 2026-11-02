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
  readEntityEnvelope,
  readWireSelection,
} from '@entifix/core';
import { EventSourceTag } from '@entifix/transactions';
import {
  MediaAltMissing,
  MediaNotHttps,
} from '@r10c/business-ts-catalog-contracts';
import { InvalidBody } from '@r10c/business-ts-common';
import {
  type OfferingTransition,
  preserveOfferingLifecycle,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  PublishProductOfferingUC,
  refuseSpecificationMedia,
  SpecificationCommandsTag,
  transitionOfferingFor,
  transitionOfferingSelection,
  UnpublishProductOfferingUC,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Option } from 'effect';

/** The per-organization store refuses a scope with none; the guard always names one. */
const organizationOf = (context: EntityApiContext) =>
  context.organizationId as string;

/**
 * A vendor's specifications. A create's `code` is the next of the
 * organization's counter, drawn in the same unit of work as the record and
 * claimed on its `Idempotency-Key`, so a retried create answers the record it
 * wrote rather than drawing another code. The media rule runs before anything
 * is written, on create and on update.
 */
export const productSpecificationApi = defineEntityApi(
  ProductSpecification,
  entityKey(ProductSpecification, 'product-specification'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    // The update's half of the media rule; the create runs it itself.
    prepare: specification =>
      Effect.as(refuseSpecificationMedia(specification), specification),
    errors: [MediaNotHttps, MediaAltMissing],
    override: {
      create: {
        idempotent: 'unit',
        errors: [MediaNotHttps, MediaAltMissing, Invalid, DuplicateKey],
        handler: (request: EntityApiRequest, context: EntityApiContext) =>
          Effect.gen(function* () {
            const specification = yield* readEntityEnvelope(
              ProductSpecification,
              request.payload,
            );
            yield* refuseSpecificationMedia(specification);
            const commands = yield* SpecificationCommandsTag;
            const created = yield* commands.create(
              organizationOf(context),
              specification,
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
    useCases: [publish, unpublish],
  },
);

export const productOfferingPriceApi = defineEntityApi(
  ProductOfferingPrice,
  entityKey(ProductOfferingPrice, 'product-offering-price'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
  },
);
