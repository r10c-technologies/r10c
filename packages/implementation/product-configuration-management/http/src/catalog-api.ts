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
  CatalogImport,
  CatalogImportLimitTag,
  type ImportCatalogPayload,
  ImportCatalogUC,
  ImportTooLarge,
  type KitPayload,
  moveSpecificationFor,
  ObsoleteProductSpecificationUC,
  type OfferingTransition,
  preparePrice,
  preserveOfferingLifecycle,
  preserveSpecificationLifecycle,
  type PriceTiersPayload,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  PublishProductOfferingUC,
  refuseSpecificationFits,
  refuseSpecificationMedia,
  ReleaseProductSpecificationUC,
  removeSpecificationFor,
  RetireProductSpecificationUC,
  ReviseProductSpecificationUC,
  reviseSpecificationFor,
  type SaleUnitPayload,
  SetKitUC,
  SetPriceTiersUC,
  SetSaleUnitUC,
  SetStockSourceUC,
  SetVariantUC,
  SkuInvalid,
  SpecificationCommandsTag,
  type SpecificationMove,
  startSpecificationSeries,
  type StockSourcePayload,
  transitionOfferingFor,
  transitionOfferingSelection,
  UnpublishProductOfferingUC,
  type VariantPayload,
} from '@r10c/business-ts-product-configuration-management';
import { VariantInvalid } from '@r10c/business-ts-sales-vocabulary';
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
 * ⚠️ **A version is edited and deleted only in design** (ADR 0079 §1), as the
 * entity's `writableWhen`/`deletableWhen` declare: the shell refuses the
 * update in its own conditional write and checks the delete before this
 * override's, which is conditional too. The update's `prepare` carries the
 * lifecycle across from what is stored. Only the four verbs move
 * `lifecycleStatus`.
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
    errors: [MediaNotHttps, MediaAltMissing, DeviceModelUniversalNotAlone],
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
        errors: [NotFound],
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

/**
 * `POST /api/product-offering/:id/draw-on-stock` — the vendor says the
 * offering is a presentation drawing on a base offering's stock, or that it no
 * longer is (ADR 0082 §7). Answered with the record at its new revision.
 */
const drawOnStock = verbEndpoint(SetStockSourceUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const offering = yield* SetStockSourceUC.run({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        payload: request.payload as StockSourcePayload,
      });
      return makeEntityEnvelope(
        ProductOffering,
        offering,
        context.links.record(offering.id),
      );
    }),
});

/**
 * `POST /api/product-offering/:id/set-kit` — the vendor says which of their
 * offerings one of this holds, and how many of each, or that it is a plain
 * offering again (ADR 0086). Answered with the record at its new revision.
 */
const setKit = verbEndpoint(SetKitUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const offering = yield* SetKitUC.run({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        payload: request.payload as KitPayload,
      });
      return makeEntityEnvelope(
        ProductOffering,
        offering,
        context.links.record(offering.id),
      );
    }),
});

/**
 * `POST /api/product-offering/:id/set-variant` — the vendor says which colour,
 * size, finish or capacity of its product this offering is (ADR 0085).
 * Answered with the record at its new revision.
 */
const setVariant = verbEndpoint(SetVariantUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const offering = yield* SetVariantUC.run({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        payload: request.payload as VariantPayload,
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
    // An offering's own pictures, the variant's product and a malformed SKU
    // are refused on the save (ADR 0061, ADR 0085).
    errors: [MediaNotHttps, MediaAltMissing, VariantInvalid, SkuInvalid],
    useCases: [
      publish,
      unpublish,
      setSaleUnit,
      drawOnStock,
      setKit,
      setVariant,
    ],
  },
);

/**
 * `POST /api/product-offering-price/:id/set-price-tiers` — the vendor says
 * where the price steps down by quantity (ADR 0082 §8). Answered with the
 * record at its new revision.
 */
const setPriceTiers = verbEndpoint(SetPriceTiersUC, {
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const price = yield* SetPriceTiersUC.run({
        organizationId: organizationOf(context),
        id: request.params?.id as string,
        payload: request.payload as PriceTiersPayload,
      });
      return makeEntityEnvelope(
        ProductOfferingPrice,
        price,
        context.links.record(price.id),
      );
    }),
});

/**
 * A vendor's prices. A price is for one, a hundred or a thousand units
 * (ADR 0082 §5); a save naming another quantity is refused `pricePerInvalid`.
 * Its tiers are written by `set-price-tiers` only: a save carries the stored
 * ones across and refuses a base price lowered to or below one (§8).
 */
export const productOfferingPriceApi = defineEntityApi(
  ProductOfferingPrice,
  entityKey(ProductOfferingPrice, 'product-offering-price'),
  {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: (price, context) => preparePrice(price, organizationOf(context)),
    useCases: [setPriceTiers],
  },
);

/**
 * `POST /api/catalog-import/import` — a vendor's catalog from a sheet the
 * browser already parsed (ADR 0084). Answered with the import's record: what
 * was created and which rows were refused, with their codes.
 *
 * The `Idempotency-Key` is the import's id and the root of every row's
 * claim, so a resubmitted sheet resumes rather than doubling the catalog.
 */
const importCatalog = verbEndpoint(ImportCatalogUC, {
  idempotent: 'unit',
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const key = Option.getOrElse(
        yield* Effect.serviceOption(IdempotencyKeyTag),
        () => globalThis.crypto.randomUUID(),
      );
      const record = yield* ImportCatalogUC.run({
        organizationId: organizationOf(context),
        key,
        source: yield* EventSourceTag,
        at: new Date(),
        maxRows: (yield* CatalogImportLimitTag).maxRows,
        payload: request.payload as ImportCatalogPayload,
      });
      return makeEntityEnvelope(
        CatalogImport,
        record,
        context.links.record(record.id),
      );
    }),
});

/**
 * A vendor's catalog imports, read-only: the import verb writes every record,
 * and nothing edits or deletes one — it is the account of what a sheet did.
 */
export const catalogImportApi = defineEntityApi(
  CatalogImport,
  entityKey(CatalogImport, 'catalog-import'),
  {
    verbs: ['list', 'get'],
    guard: { kind: 'organization' },
    errors: [ImportTooLarge],
    useCases: [importCatalog],
  },
);
