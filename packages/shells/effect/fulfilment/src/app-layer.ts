import { startTenantOutboxRelay } from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import { MongoShippingOrderStoreLayer } from '@r10c/implementation-fulfilment-mongo';
import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetIdempotencyLayer,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetTenantMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

const SERVICE_NAME = 'fulfilment-service';

/** The **slice** this service publishes as — never the deployment (ADR 0029). */
export const FULFILMENT_SLICE = 'fulfilment';

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
 */
export const fulfilmentComposition = (configuration: FleetConfiguration) =>
  Effect.gen(function* () {
    const connections = Layer.mergeAll(
      yield* fleetTenantMongoLayer(configuration, ['fulfilment']),
      yield* fleetSecurityLayer(configuration),
      yield* crossingTokenLayer(configuration),
      yield* fleetBusLayer(configuration),
      yield* fleetOutboxLayer(configuration, FULFILMENT_SLICE),
    );

    // The crossing routes' `Idempotency-Key` records, in a database of their
    // own the tenant directory's `fulfilment_` prefix never matches.
    const idempotency = yield* fleetIdempotencyLayer(
      configuration,
      FULFILMENT_IDEMPOTENCY_DB,
    );

    return Layer.provideMerge(
      Layer.effectDiscard(
        startTenantOutboxRelay({ onOutcome: logMechanismOutcome }),
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
