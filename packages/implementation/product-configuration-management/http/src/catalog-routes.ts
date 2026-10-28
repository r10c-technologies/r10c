import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntifixEnvelopeLink,
  EntifixLockError,
  type EntityId,
  isFailure,
  isTag,
  makeEntityEnvelope,
  readWireSelection,
} from '@entifix/core';
import {
  type EntityRouteContext,
  makeEntityRoutes,
  requireOrganization,
  routeFailure,
} from '@entifix/service-shell';
import { EventSourceTag } from '@entifix/transactions';
import {
  IllegalOfferingTransition,
  type OfferingCatalogTag,
  OfferingChanged,
  OfferingHasNoPrice,
  OfferingHasNoSpecification,
  type OfferingTransition,
  preserveOfferingLifecycle,
  ProductOffering,
  ProductOfferingPrice,
  ProductSpecification,
  PUBLISH_PRODUCT_OFFERING,
  refuseSpecificationMedia,
  SpecificationCommandsTag,
  transitionOfferingFor,
  transitionOfferingSelection,
  UNPUBLISH_PRODUCT_OFFERING,
} from '@r10c/business-ts-product-configuration-management';
import { Effect, Layer } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

/** What a host provides for {@link catalogRoutes}. */
export type CatalogRouteServices =
  | EntityRepositoryFactoryTag
  | OfferingCatalogTag
  | SpecificationCommandsTag
  | EventSourceTag
  | TokenServiceTag
  | PolicyDecisionTag;

/** The per-organization store refuses a scope with none; the guard always names one. */
const organizationOf = (context: EntityRouteContext) =>
  context.organizationId as string;

const refusalCode = (error: object): string | undefined =>
  'code' in error && typeof error.code === 'string' ? error.code : undefined;

/**
 * `POST /api/product-specification` — a **command**, answered `202` before
 * the write is done (ADR 0028). The browser follows the `status` link and
 * reconciles over the stream (ADR 0043). A held code lock is `409` — try
 * again — and an invalid command `400` with the rule that refused it.
 */
const acceptSpecification = (context: EntityRouteContext) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const commands = yield* SpecificationCommandsTag;
    const { transactionId } = yield* commands.accept(
      organizationOf(context),
      yield* request.json,
    );
    return yield* HttpServerResponse.json(
      {
        meta: {
          type: 'transactionAccepted',
          entity: 'product-specification',
          links: [
            {
              rel: 'status',
              href: `/api/transaction/${transactionId}`,
              method: 'GET',
            },
          ],
        },
        data: { transactionId, state: 'PENDING' },
      },
      { status: 202 },
    );
  }).pipe(
    Effect.catch(error =>
      error instanceof EntifixLockError || isTag('Contention')(error)
        ? HttpServerResponse.json(
            {
              error: 'resource busy, try again',
              code: 'resourceBusy',
              detail: error.message,
            },
            { status: 409 },
          )
        : error instanceof EntifixBuildError ||
            (isFailure(error) && error.category === 'invalid')
          ? HttpServerResponse.json(
              {
                error: 'invalid command',
                code: refusalCode(error) ?? 'invalidCommand',
                detail: error.message,
              },
              { status: 400 },
            )
          : routeFailure(error),
    ),
  );

const offeringLinks = (id: EntityId): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `/api/product-offering/${String(id)}`, method: 'GET' },
  { rel: 'list', href: '/api/product-offering', method: 'GET' },
  { rel: 'update', href: `/api/product-offering/${String(id)}`, method: 'PUT' },
  {
    rel: 'delete',
    href: `/api/product-offering/${String(id)}`,
    method: 'DELETE',
  },
];

const conflict = (error: string, code: string, detail: string) =>
  HttpServerResponse.json({ error, code, detail }, { status: 409 });

/** Each refusal a transition can meet, as the `409` that names it. */
const transitionRefused = (failure: unknown) =>
  failure instanceof IllegalOfferingTransition
    ? conflict(
        'illegal offering transition',
        failure.code,
        `An offering in '${failure.from}' cannot be ${failure.transition}ed.`,
      )
    : failure instanceof OfferingHasNoPrice
      ? conflict(
          'offering has no price',
          failure.code,
          'An offering needs a price before it can reach the storefront: ' +
            'the published record carries an amount and a currency.',
        )
      : failure instanceof OfferingHasNoSpecification
        ? conflict(
            'offering has no specification',
            failure.code,
            `This offering names specification '${failure.specificationId}', ` +
              'which no longer exists. The published record copies its name, ' +
              'description, brand and category.',
          )
        : failure instanceof OfferingChanged
          ? conflict(
              'the offering changed',
              failure.code,
              'Another change to this offering landed first. Reload it and try again.',
            )
          : routeFailure(failure);

/** `POST /api/product-offering/:id/<verb>` — one offering. */
const transitionOne =
  (transition: OfferingTransition) => (organizationId: string) =>
    Effect.gen(function* () {
      const id = (yield* HttpRouter.params)['id'] as string;
      const offering = yield* transitionOfferingFor({
        organizationId,
        id,
        transition,
        source: yield* EventSourceTag,
      });
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(
          ProductOffering,
          offering,
          offeringLinks(offering.id),
        ),
      );
    }).pipe(Effect.catch(transitionRefused));

/**
 * `POST /api/product-offering/<verb>` — the same verb over a selection
 * (#216), and **the same permission as the per-id route**: a separate grant
 * would be a role that could publish one offering but not twenty.
 */
const transitionSelected =
  (transition: OfferingTransition) => (organizationId: string) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const body = (yield* request.json) as { selection?: unknown };
      const selection = readWireSelection<ProductOffering>(body.selection);
      if (!selection) {
        return yield* HttpServerResponse.json(
          {
            error: 'invalid request body',
            code: 'invalidBody',
            detail:
              'A bulk request carries a `selection` in `ids` or `matching` mode.',
          },
          { status: 400 },
        );
      }
      const outcomes = yield* transitionOfferingSelection({
        organizationId,
        selection,
        transition,
        source: yield* EventSourceTag,
      });
      return yield* HttpServerResponse.json({
        meta: { type: 'bulkOutcome', entity: 'product-offering' },
        data: outcomes,
      });
    }).pipe(Effect.catch(routeFailure));

/**
 * marketplace-admin-service's surface: a vendor's catalog, every route a
 * session bound to that vendor's organization and resolved to its own
 * `tenant_<id>` database.
 *
 * ⚠️ An offering's `status` is **server-owned** (ADR 0047): its save carries
 * the stored status across, and only the two verbs move it — each checking
 * the price and the specification, and announcing what it did.
 */
export const catalogRoutes = Layer.mergeAll(
  makeEntityRoutes.for<
    SpecificationCommandsTag | HttpServerRequest.HttpServerRequest
  >()(ProductSpecification, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    // The update's half of the media rule; the create's is in the command.
    prepare: specification =>
      Effect.as(refuseSpecificationMedia(specification), specification),
    override: { create: acceptSpecification },
  }),
  makeEntityRoutes.for<EntityRepositoryFactoryTag>()(ProductOffering, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
    prepare: (offering, context) =>
      // A store that cannot be opened is a 500, never a refusal of the body.
      preserveOfferingLifecycle(offering, organizationOf(context)).pipe(
        Effect.orDie,
      ),
  }),
  makeEntityRoutes(ProductOfferingPrice, {
    verbs: ['list', 'get', 'create', 'update', 'delete'],
    guard: { kind: 'organization' },
  }),
  HttpRouter.addAll([
    HttpRouter.route(
      'POST',
      '/api/product-offering/:id/publish',
      requireOrganization(PUBLISH_PRODUCT_OFFERING)(transitionOne('publish')),
    ),
    HttpRouter.route(
      'POST',
      '/api/product-offering/:id/unpublish',
      requireOrganization(UNPUBLISH_PRODUCT_OFFERING)(
        transitionOne('unpublish'),
      ),
    ),
    HttpRouter.route(
      'POST',
      '/api/product-offering/publish',
      requireOrganization(PUBLISH_PRODUCT_OFFERING)(
        transitionSelected('publish'),
      ),
    ),
    HttpRouter.route(
      'POST',
      '/api/product-offering/unpublish',
      requireOrganization(UNPUBLISH_PRODUCT_OFFERING)(
        transitionSelected('unpublish'),
      ),
    ),
  ]),
);
