import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetSecurityLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { httpVendorFactsLayer } from './flow/vendor-facts.js';
import {
  type Participant,
  type RunnerReplica,
  workflowComposition,
} from './workflow/workflow-layer.js';

const SERVICE_NAME = 'transaction-service';

/** The services a flow's fragments call, by the name each fragment gives. */
const STOCK_PARTICIPANT = 'stock-service';
const ORDER_PARTICIPANT = 'order-service';
const PAYMENT_PARTICIPANT = 'payment-service';
const FULFILMENT_PARTICIPANT = 'fulfilment-service';

/**
 * Where each participant is reached, and the crossing token it takes.
 *
 * ⚠️ **A crossing token per participant, and each is that participant's
 * own.** Reusing one across services — or reusing the fleet's
 * `CONFIG_SERVICE_TOKEN` — would make a single leaked secret a tenant-data
 * write capability everywhere at once. They are separate `is_secret` rows
 * with separate rotations (ADR 0023), and holding several is the
 * concentration ADR 0039 recorded rather than a new class of risk.
 */
const readParticipants = ({ store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const participant = store.in('participant');
    return {
      [STOCK_PARTICIPANT]: {
        baseUrl: yield* participant.getString('stockUrl'),
        crossingToken: yield* participant.getString('stockToken'),
      },
      [ORDER_PARTICIPANT]: {
        baseUrl: yield* participant.getString('orderUrl'),
        crossingToken: yield* participant.getString('orderToken'),
      },
      [PAYMENT_PARTICIPANT]: {
        baseUrl: yield* participant.getString('paymentUrl'),
        crossingToken: yield* participant.getString('paymentToken'),
      },
      // The delivery flow's participant (ADR 0070): opening, holding and
      // dispatching a vendor's shipment, on its own crossing token.
      [FULFILMENT_PARTICIPANT]: {
        baseUrl: yield* participant.getString('fulfilmentUrl'),
        crossingToken: yield* participant.getString('fulfilmentToken'),
      },
    } satisfies Readonly<Record<string, Participant>>;
  });

/**
 * The `transaction` slice's composition, mounted by its service alone (ADR
 * 0064): the durable flow engine over the `workflow` store, replica 0's
 * runner, and what its start routes verify a vendor against.
 *
 * It owns no Mongo store. A start's idempotency is the engine's own
 * registration of the `Idempotency-Key`, in the `workflow` store, so nothing
 * else needs one (ADR 0066).
 */
export const transactionComposition =
  (runner: RunnerReplica) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;
      const participants = yield* readParticipants(configuration);
      // The published vendor projection, read for what each vendor a flow
      // acts for is provisioned for.
      const catalogUrl = yield* store.in('marketplace').getString('url');

      const connections = Layer.mergeAll(
        // This slice's rows were named `amqp` before the rest of the fleet's.
        yield* fleetBusLayer(configuration, 'amqp'),
        yield* fleetSecurityLayer(configuration),
        // ⚠️ **This service's own *inbound* token — what a caller presents to
        // start a flow — and a different secret from the outbound ones above.**
        // The coordinator is both a callee and a caller, and collapsing the two
        // directions onto one value would mean anyone allowed to *start* a
        // checkout held the key that *writes* a vendor's stock.
        yield* crossingTokenLayer(configuration),
      );

      // `provideMerge`, not `provide`: the routes read the security layers and
      // the inbound crossing token from this composition's output, not only
      // the engine below them.
      return Layer.provideMerge(
        Layer.merge(
          yield* workflowComposition(configuration, participants, runner),
          httpVendorFactsLayer(catalogUrl),
        ),
        connections,
      );
    });

/**
 * A runner that serves no HTTP: a further replica of the flow engine, whose
 * shards are assigned in the `workflow` store the other runners registered
 * in (ADR 0066). It opens only what the engine needs — the bus its relay
 * publishes on.
 */
export const runnerComposition =
  (runner: RunnerReplica) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const participants = yield* readParticipants(configuration);
      return Layer.provide(
        yield* workflowComposition(configuration, participants, runner),
        yield* fleetBusLayer(configuration, 'amqp'),
      );
    });

/**
 * The composition, booted against the configuration config-service serves —
 * replica 0, the one that serves HTTP.
 */
export const makeAppLayer = (servicePort: number) =>
  makeFleetServiceLayer(
    SERVICE_NAME,
    transactionComposition({ servicePort, replica: 0 }),
  );

/** A runner-only replica, booted the same way. */
export const makeRunnerLayer = (runner: RunnerReplica) =>
  makeFleetServiceLayer(SERVICE_NAME, runnerComposition(runner));
