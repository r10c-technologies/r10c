import { MongoDatabaseTag } from '@entifix/mongo';
import {
  ensureOutboxIndexes,
  startOutboxRelay,
} from '@entifix/mongo/transactions';
import { logMechanismOutcome } from '@entifix/service-shell';
import {
  AccessLinkHours,
  AccessLinkIntervalSeconds,
  CancelWindowSeconds,
  type PaymentLinkProvider,
  paymentLinkProviderOf,
  PaymentLinkProvidersTag,
  ReceiptDays,
  StorefrontUrl,
} from '@r10c/business-ts-order-management';
import { smtpBuyerNotifierLayer } from '@r10c/implementation-order-management-smtp';
import { MongoOrderStoresLayer } from '@r10c/implementation-order-mongo';
import {
  crossingCallersLayer,
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetIdempotencyLayer,
  fleetOutboxLayer,
  fleetSecurityLayer,
  fleetSingleMongoLayer,
  httpFlowStarterLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startPaymentExpirySweep } from './payment-expiry-sweep.js';
import { startPaymentStatusProjection } from './payment-status.js';
import { startReceiptRedactionSweep } from './receipt-redaction-sweep.js';

const SERVICE_NAME = 'order-service';

/** The configuration group whose rows are the payment-link providers. */
export const PAYMENT_LINK_PROVIDER_GROUP = 'paymentLinkProvider';

/** The **slice** this service publishes as — never the deployment, never the domain (ADR 0029). */
export const ORDER_SLICE = 'order';

/**
 * The `order` slice's composition — the `order` store's only writer, mounted by
 * order-service and nothing else (ADR 0064).
 *
 * ⚠️ **`MongoDatabaseLayer`, not `MongoClientLayer`, and that is the plane
 * rather than a preference.** stock-service and marketplace-admin-service take
 * the pool and resolve `stock_<id>` / `tenant_<id>` inside each request, because
 * their stores are per-organization. The `order` store is **platform** plane and
 * single-partitioned: one database, named at boot. Resolving a handle per
 * request here would be inventing a tenancy the store does not have — and a
 * basket spanning two vendors could not live in either of their databases
 * anyway, which is *why* it is platform plane (ADR 0022,
 * `docs/_shared/planes.md`).
 *
 * ⚠️ **A crossing token, and this service's own.** It is a flow *participant*:
 * the coordinator writes an order on a buyer's behalf, and the buyer holds no
 * grant over that act. Reusing stock-service's token — or the fleet's
 * `CONFIG_SERVICE_TOKEN` — would make one leaked secret reach both stores at
 * once, so it is a separate `is_secret` row with its own rotation
 * ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * ⚠️ **AMQP is dialled at boot and probed.** A service that opens a broker
 * connection eagerly and registers no probe exits `1` against a merely slow
 * broker while the health ladder green-lights a booting fleet — the trap
 * marketplace-service hit. `AmqpHealthProbeLayer` sits in the probe tier above
 * the bus for exactly that reason.
 *
 * The broker earns its place twice over: the relay publishes `order.placed`
 * (#232), and the projection consumes `payment.captured` to advance an order
 * from `pending` to `paid`. The capture itself is a flow step and does not
 * arrive here as a message — only its consequence does
 * ([ADR 0054](../../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)).
 *
 * No Redis: this slice takes no lock and draws from no sequence.
 */
export const orderComposition = (configuration: FleetConfiguration) =>
  Effect.gen(function* () {
    const { store } = configuration;

    // The buyer's own cancel window, in seconds. Read here rather than in the
    // route so a missing row stops the process at boot instead of failing one
    // checkout at request time — and `getNumber` rather than a cast, because a
    // `NaN` window is a window every comparison falls out of.
    const cancelWindowSeconds = yield* store
      .in('order')
      .getNumber('cancelWindowSeconds');
    // How long the buyer's capability may still read the receipt, in days —
    // the receipt outlives the cancel window (ADR 0076 §6). Read at boot for
    // the same reason as the window above.
    const receiptDays = yield* store.in('order').getNumber('receiptDays');
    // The buyer's way back (ADR 0076 §6): how long a mailed access link may be
    // redeemed, how often a lookup may mail one, and the storefront origin a
    // link is written against — read at boot for the reason above.
    const accessLinkHours = yield* store
      .in('order')
      .getNumber('accessLinkHours');
    const accessLinkIntervalSeconds = yield* store
      .in('order')
      .getNumber('accessLinkIntervalSeconds');
    const storefrontUrl = yield* store.in('order').getString('storefrontUrl');
    // How often unpaid payment-link orders are looked for past their window
    // (ADR 0081 §4). The window itself is the coordinator's row, not ours.
    const paymentExpirySweepMs = yield* store
      .in('order')
      .getNumber('paymentExpirySweepMs');
    // The payment-link providers a seller may name: an open dictionary, one
    // row per provider, public facts only (ADR 0081 §10). A row that does not
    // read as a provider drops out rather than admitting any host.
    const providers = (
      configuration.plain[PAYMENT_LINK_PROVIDER_GROUP] ?? []
    ).flatMap((row): PaymentLinkProvider[] => {
      const provider = paymentLinkProviderOf(row.key, row.value);
      return provider === undefined ? [] : [provider];
    });
    // Where the buyer's mail goes out: Mailpit in the lab. Not dialled at
    // boot — a mail server that is down fails the notify step, which retries,
    // and never stops orders being taken.
    const smtp = store.in('smtp');
    const smtpOptions = {
      host: yield* smtp.getString('host'),
      port: yield* smtp.getNumber('port'),
      from: yield* smtp.getString('from'),
    };

    // Where the cancellation coordinator answers, and the secret this service
    // presents to start a flow through it.
    //
    // ⚠️ **The coordinator's *inbound* token, deliberately not `service.token`.**
    // That one is what transaction-service presents *to* this process when it
    // dispatches a step; this is what this process presents *to*
    // transaction-service to start one. One shared value would mean anyone
    // allowed to write an order also held the key that starts any flow in the
    // fleet ([ADR 0023](../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
    //
    // This makes order-service the **third** holder of that secret, beside the
    // storefront and sales-service — and unlike either of those it is also a
    // participant in the flow it starts. The cycle is accepted in ADR 0058 §6:
    // a cancellation's authority is a buyer's capability or a vendor's session,
    // and neither is verifiable anywhere but here.
    const coordinatorUrl = yield* store.in('transaction').getString('url');
    const coordinatorToken = yield* store
      .in('transaction')
      .getString('crossingToken');

    const connections = Layer.mergeAll(
      yield* fleetSingleMongoLayer(configuration, ['order']),
      yield* fleetBusLayer(configuration),
      yield* fleetSecurityLayer(configuration),
      yield* crossingTokenLayer(configuration),
      // The storefront's own token, for "find my order" alone (ADR 0076 §6).
      yield* crossingCallersLayer(configuration, ['storefront']),
      yield* fleetOutboxLayer(configuration, ORDER_SLICE),
      Layer.succeed(CancelWindowSeconds, cancelWindowSeconds),
      Layer.succeed(ReceiptDays, receiptDays),
      Layer.succeed(AccessLinkHours, accessLinkHours),
      Layer.succeed(AccessLinkIntervalSeconds, accessLinkIntervalSeconds),
      Layer.succeed(StorefrontUrl, storefrontUrl.replace(/\/+$/, '')),
      Layer.succeed(PaymentLinkProvidersTag, providers),
      smtpBuyerNotifierLayer(smtpOptions),
      httpFlowStarterLayer({
        url: coordinatorUrl,
        crossingToken: coordinatorToken,
      }),
    );

    // The outbox's indexes before the first write; the store ensures its own as
    // it builds. An outbox whose `eventId` is not unique would let a redelivery
    // enqueue a second copy of the same announcement.
    // The participant routes' idempotency records live in the `order` store's
    // own database, beside the command claims their units of work take.
    const idempotency = yield* fleetIdempotencyLayer(configuration);

    const stored = Layer.provideMerge(
      MongoOrderStoresLayer,
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.effectDiscard(
            Effect.flatMap(MongoDatabaseTag, ensureOutboxIndexes),
          ),
          idempotency,
        ),
        connections,
      ),
    );

    return Layer.provideMerge(
      Layer.mergeAll(
        // The relay reports what it did; this fork site decides how loud.
        Layer.effectDiscard(
          startOutboxRelay({ onOutcome: logMechanismOutcome }),
        ),
        Layer.effectDiscard(startPaymentStatusProjection),
        // The buyer's contact leaves once its job is done (ADR 0076 §4).
        Layer.effectDiscard(startReceiptRedactionSweep),
        // A payment-link order its buyer never paid lets go at its window.
        Layer.effectDiscard(startPaymentExpirySweep(paymentExpirySweepMs)),
      ),
      stored,
    );
  });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = () =>
  makeFleetServiceLayer(SERVICE_NAME, orderComposition);
