import { startTenantOutboxRelay } from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import {
  type Courier,
  courierOf,
  CouriersTag,
  type CourierTracking,
  CourierTrackingTag,
  simulatedCourierTracking,
} from '@r10c/business-ts-shipping-order-management';
import { MongoShippingOrderStoreLayer } from '@r10c/implementation-fulfilment-mongo';
import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetIdempotencyLayer,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  httpFlowStarterLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startCourierFeed } from './courier-feed-sweep.js';
import {
  DestinationRetentionDays,
  startDestinationRedactionSweep,
} from './destination-redaction-sweep.js';

const SERVICE_NAME = 'fulfilment-service';

/** The **slice** this service publishes as — never the deployment (ADR 0029). */
export const FULFILMENT_SLICE = 'fulfilment';

/** The configuration group the courier dictionary is read from (ADR 0081 §10). */
export const COURIER_GROUP = 'courier';

/** The database the crossing routes' idempotency records live in. */
export const FULFILMENT_IDEMPOTENCY_DB = 'fulfilment-idempotency';

/**
 * The `fulfilment` slice's composition, mounted by its service alone (ADR
 * 0064) — the `fulfilment` store's only writer.
 *
 * **`MongoClientLayer`, never a named database**, for stock's reason: every
 * handle is `fulfilment_<organizationId>`, resolved inside the request from the
 * verified session or a crossing's named organization. ⚠️ The prefix is
 * `fulfilment_`, a fourth tenant store beside `tenant_`, `stock_` and `sales_`,
 * and the only thing keeping them apart is the prefix this resolver was built
 * with.
 *
 * AMQP and an outbox per organization, because a shipment past dispatch
 * announces itself for the delivery flow that waits on it (ADR 0070); the
 * store drains each outbox at commit and the tenant relay walks every
 * `fulfilment_*` database for what a drain left behind.
 *
 * ⚠️ **Its own crossing secret.** Opening, holding, withdrawing and dispatching
 * a vendor's shipment are a flow's acts on that vendor's store, behind a token
 * that is this service's alone (ADR 0023).
 *
 * ⚠️ **And the coordinator's inbound one.** A vendor's dispatch starts the
 * delivery flow, which makes this service the fourth holder of that secret,
 * beside the storefront, sales-service and order-service — and, as
 * order-service is for a cancellation, a participant in the flow it starts:
 * a dispatch's authority is the vendor's session, verifiable only here.
 */
export const fulfilmentComposition = (configuration: FleetConfiguration) =>
  Effect.gen(function* () {
    const coordinator = configuration.store.in('transaction');
    // A dial, not a constant: how long an address outlives its parcel is a
    // product choice (ADR 0076 §4).
    const retentionDays = yield* configuration.store
      .in('fulfilment')
      .getNumber('destinationRetentionDays');
    // The couriers a vendor may name: an open dictionary, one row per courier,
    // public facts only (ADR 0081 §10). A row that does not read as a courier
    // drops out rather than rendering a broken tracking link.
    const couriers = (configuration.plain[COURIER_GROUP] ?? []).flatMap(
      (row): Courier[] => {
        const courier = courierOf(row.key, row.value);
        return courier === undefined ? [] : [courier];
      },
    );
    // The lab's courier answers a dispatched parcel delivered after this many
    // seconds; `0` is no simulator, and an environment with a real courier
    // feed sets it so (ADR 0081 §11).
    const simulatorDelaySeconds = yield* configuration.store
      .in('fulfilment')
      .getNumber('courierSimulatorDelaySeconds');
    const tracking: CourierTracking | undefined =
      simulatorDelaySeconds > 0
        ? simulatedCourierTracking(simulatorDelaySeconds * 1000)
        : undefined;
    const connections = Layer.mergeAll(
      httpFlowStarterLayer({
        url: yield* coordinator.getString('url'),
        crossingToken: yield* coordinator.getString('crossingToken'),
      }),
      yield* fleetTenantMongoLayer(configuration, ['fulfilment']),
      yield* fleetSecurityLayer(configuration),
      yield* crossingTokenLayer(configuration),
      yield* fleetBusLayer(configuration),
      yield* fleetOutboxLayer(configuration, FULFILMENT_SLICE),
      Layer.succeed(DestinationRetentionDays, retentionDays),
      Layer.succeed(CouriersTag, couriers),
    );

    // The crossing routes' `Idempotency-Key` records, in a database of their
    // own the tenant directory's `fulfilment_` prefix never matches.
    const idempotency = yield* fleetIdempotencyLayer(
      configuration,
      FULFILMENT_IDEMPOTENCY_DB,
    );

    return Layer.provideMerge(
      Layer.mergeAll(
        Layer.effectDiscard(
          startTenantOutboxRelay({ onOutcome: logMechanismOutcome }),
        ),
        // A shipment's address leaves once its journey ends (ADR 0076 §4).
        Layer.effectDiscard(startDestinationRedactionSweep),
        // The courier's reports, when this environment has a feed to ask.
        tracking === undefined
          ? Layer.empty
          : Layer.effectDiscard(
              startCourierFeed.pipe(
                Effect.provideService(CourierTrackingTag, tracking),
              ),
            ),
      ),
      Layer.provideMerge(
        Layer.mergeAll(MongoShippingOrderStoreLayer, idempotency),
        connections,
      ),
    );
  });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = () =>
  makeFleetServiceLayer(SERVICE_NAME, fulfilmentComposition);
