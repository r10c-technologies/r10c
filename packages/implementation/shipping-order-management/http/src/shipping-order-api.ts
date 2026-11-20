import {
  defineEntityApi,
  type EntityApiRequest,
  IdempotencyKeyTag,
  OrganizationIdTag,
  verbEndpoint,
} from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  type EntifixEnvelopeLink,
  entityKey,
  implement,
  Invalid,
  JsonBody,
  makeEntityEnvelope,
  makeEnvelope,
  NotFound,
  readWireSelection,
  StaleRevision,
} from '@entifix/core';
import { InvalidBody, readStepRecord } from '@r10c/business-ts-common';
import type { FlowAccepted } from '@r10c/business-ts-flow-contracts';
import {
  CouriersTag,
  decodeShipmentDestination,
  dispatchShipment,
  dispatchShipmentSelection,
  DispatchShippingOrderUC,
  type GuidePayload,
  RecordDeliveryUC,
  recordGuide,
  RecordGuideUC,
  RecordRefusalUC,
  RecordReturnUC,
  ShippingOrder,
  ShippingOrderNotTransitionable,
  ShippingOrderStoreTag,
  type ShippingTransition,
} from '@r10c/business-ts-shipping-order-management';
import { Effect, Option, Schema } from 'effect';

const KEY = entityKey(ShippingOrder, 'shipping-order');
const BASE = `/api/${KEY}` as const;

/** The `Idempotency-Key` a crossing write is claimed on, in its unit of work. */
const commandId = Effect.map(
  Effect.serviceOption(IdempotencyKeyTag),
  Option.getOrUndefined,
);

const recordLinks = (id: string): EntifixEnvelopeLink[] => [
  { rel: 'self', href: `${BASE}/${id}`, method: 'GET' },
  { rel: 'list', href: BASE, method: 'GET' },
];

const envelopeOf = (order: ShippingOrder) =>
  makeEntityEnvelope(ShippingOrder, order, recordLinks(String(order.id)));

/** One move on one of the caller's organization's shipments. */
const move = (id: string, transition: ShippingTransition) =>
  Effect.gen(function* () {
    const store = yield* ShippingOrderStoreTag;
    const moved = yield* store.transition(
      yield* OrganizationIdTag,
      id,
      transition,
      new Date(),
      yield* commandId,
    );
    return envelopeOf(moved);
  });

const MOVE_ERRORS = [
  NotFound,
  ShippingOrderNotTransitionable,
  Invalid,
  DuplicateKey,
  StaleRevision,
];

/** A vendor verb on their own shipment, behind their session and its grant. */
const vendorVerb = (
  useCase:
    typeof RecordDeliveryUC | typeof RecordRefusalUC | typeof RecordReturnUC,
  transition: ShippingTransition,
) =>
  verbEndpoint(useCase, {
    guard: { kind: 'organization' },
    handler: (request: EntityApiRequest) =>
      move(request.params?.id as string, transition),
  });

/**
 * A vendor's dispatch starts the delivery flow, whose pivot is the dispatch
 * itself, and answers `202` with the flow to follow (ADR 0070, ADR 0073). The
 * three courier reports below stay plain moves: each announces itself, and the
 * coordinator's consumer answers the flow's wait with it.
 */
const dispatchVerb = verbEndpoint(DispatchShippingOrderUC, {
  guard: { kind: 'organization' },
  accepted: true,
  handler: (request: EntityApiRequest) =>
    Effect.gen(function* () {
      const accepted: FlowAccepted = yield* dispatchShipment({
        organizationId: yield* OrganizationIdTag,
        shippingOrderId: request.params?.id as string,
      });
      return makeEnvelope('flowAccepted', KEY, accepted);
    }),
  // The same verb over the worklist's selection: one delivery flow per
  // shipment, each row answering whether its flow started.
  bulk: (request: EntityApiRequest) =>
    Effect.gen(function* () {
      const selection = readWireSelection<ShippingOrder>(
        (request.payload as { readonly selection?: unknown }).selection,
      );
      if (!selection) {
        return yield* new InvalidBody({
          reason:
            'a bulk request carries a `selection` in `ids` or `matching` mode',
        });
      }
      const outcomes = yield* dispatchShipmentSelection({
        organizationId: yield* OrganizationIdTag,
        selection,
      });
      return makeEnvelope('bulkOutcome', KEY, outcomes);
    }),
});

/**
 * The vendor records the guide a parcel leaves with, checked against the
 * courier dictionary (ADR 0081 §11). Not a move: the shipment still awaits
 * dispatch, and the last guide recorded is the one that leaves.
 */
const guideVerb = verbEndpoint(RecordGuideUC, {
  guard: { kind: 'organization' },
  idempotent: 'edge',
  handler: (request: EntityApiRequest) =>
    Effect.gen(function* () {
      const recorded = yield* recordGuide({
        organizationId: yield* OrganizationIdTag,
        shippingOrderId: request.params?.id as string,
        payload: request.payload as GuidePayload,
      });
      return envelopeOf(recorded);
    }),
});

const deliveryVerb = vendorVerb(RecordDeliveryUC, 'record-delivery');
const refusalVerb = vendorVerb(RecordRefusalUC, 'record-refusal');
const returnVerb = vendorVerb(RecordReturnUC, 'record-return');

/**
 * A vendor's shipments, read behind their session and bound to their
 * organization — `fulfilment_<organizationId>` resolved from it — and moved by
 * the four verbs a vendor reaches: dispatch, and recording what the courier
 * reported (ADR 0070). Opening, holding and withdrawing a shipment are a
 * flow's, behind crossing tokens below.
 */
export const shippingOrderApi = defineEntityApi(ShippingOrder, KEY, {
  verbs: ['list', 'get'],
  guard: { kind: 'organization' },
  useCases: [dispatchVerb, guideVerb, deliveryVerb, refusalVerb, returnVerb],
});

/**
 * `GET /api/courier` — the courier dictionary a vendor picks from when they
 * record a guide: public facts only, behind the grant that reads shipments,
 * because only a vendor packing them records one (ADR 0081 §10).
 */
const couriers = defineEndpoint({
  name: 'couriers',
  method: 'GET',
  path: '/api/courier',
  success: JsonBody,
  errors: [],
  guard: {
    kind: 'permission',
    permission: 'shipping-order-management:shipping-order:read',
  },
});

/** The dictionary read, beside the shipments it labels. */
export const courierEndpoints = [
  implement(couriers, () =>
    Effect.map(CouriersTag, entries => ({ items: entries })),
  ),
] as const;

const crossing = (action: 'open' | 'hold' | 'withdraw' | 'dispatch-step') =>
  ({
    kind: 'crossing',
    permission: `shipping-order-management:shipping-order:${action}`,
    organization: true,
  }) as const;

const params = { id: Schema.String };

/**
 * `POST /api/shipping-order` — a checkout opening the vendor's shipment for
 * one vendor order, once it committed. A crossing token plus `:open` and the
 * vendor's organization in a header: the flow acts on the vendor's store on
 * the buyer's behalf, and no session holds that.
 */
const openShipment = defineEndpoint({
  name: 'open',
  method: 'POST',
  path: BASE,
  payload: JsonBody,
  success: JsonBody,
  errors: [InvalidBody, Invalid, DuplicateKey, StaleRevision],
  guard: crossing('open'),
  idempotent: 'unit',
});

/** `POST /:id/hold` — a cancellation's lock, refused once dispatched. */
const hold = defineEndpoint({
  name: 'hold',
  method: 'POST',
  path: `${BASE}/:id/hold`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing('hold'),
  idempotent: 'unit',
});

/** `DELETE /:id/hold` — the hold's release, its compensation and its undo. */
const release = defineEndpoint({
  name: 'release',
  method: 'DELETE',
  path: `${BASE}/:id/hold`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing('hold'),
  idempotent: 'unit',
});

/** `POST /:id/withdrawal` — a shipment that will never ship. */
const withdrawal = defineEndpoint({
  name: 'withdrawal',
  method: 'POST',
  path: `${BASE}/:id/withdrawal`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing('withdraw'),
  idempotent: 'unit',
});

/**
 * `POST /:id/dispatch-step` — the delivery flow's pivot. ⚠️ Not the vendor's
 * `dispatch` verb: this is the coordinator dispatching a step of a flow it
 * runs, under its own crossing permission.
 */
const dispatchStep = defineEndpoint({
  name: 'dispatch-step',
  method: 'POST',
  path: `${BASE}/:id/dispatch-step`,
  params,
  success: JsonBody,
  errors: MOVE_ERRORS,
  guard: crossing('dispatch-step'),
  idempotent: 'unit',
});

/** The flows' crossing steps on a vendor's shipments. */
export const shippingOrderEndpoints = [
  implement(openShipment, ({ payload }) =>
    Effect.gen(function* () {
      // The destination travels nested, as the flow stated it; the shipment
      // stores it as one checked row (ADR 0076 §1).
      const { destination, ...members } = payload as Record<string, unknown>;
      const order = yield* readStepRecord(ShippingOrder, members);
      if (
        order.orderId === '' ||
        order.orderNumber === '' ||
        order.lines.length === 0
      ) {
        return yield* new InvalidBody({
          reason:
            'a shipment ships one numbered vendor order, and at least one line',
        });
      }
      order.destination = [yield* decodeShipmentDestination(destination)];
      order.redactedAt = undefined;
      // One shipment per vendor order, under the order's own id: a flow on an
      // order that already exists — a cancellation's hold — names its shipment
      // without having opened it.
      order.id = order.orderId;
      const store = yield* ShippingOrderStoreTag;
      const { order: opened } = yield* store.open(
        yield* OrganizationIdTag,
        order,
        yield* commandId,
      );
      return envelopeOf(opened);
    }),
  ),
  implement(hold, ({ params: { id } }) => move(id, 'hold')),
  implement(release, ({ params: { id } }) => move(id, 'release')),
  implement(withdrawal, ({ params: { id } }) => move(id, 'withdraw')),
  implement(dispatchStep, ({ params: { id } }) => move(id, 'dispatch')),
] as const;
