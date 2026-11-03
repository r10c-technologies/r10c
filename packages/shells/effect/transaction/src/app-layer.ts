import {
  crossingTokenLayer,
  fleetBusLayer,
  type FleetConfiguration,
  fleetIdempotencyLayer,
  fleetMongoPoolLayer,
  fleetSecurityLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  HttpSagaDispatcherLayer,
  type Participant,
  ParticipantsTag,
} from './saga/http-dispatcher.js';
import {
  SagaMaxResumeAttempts,
  SagaResumeIntervalMs,
  SagaStaleAfterMs,
  startSagaResume,
} from './saga/resume.js';
import { sagaStoresLayer } from './saga/stores.js';
import {
  ORDER_PARTICIPANT,
  PAYMENT_PARTICIPANT,
  STOCK_PARTICIPANT,
} from './sagas/index.js';
import {
  type RunnerReplica,
  workflowComposition,
} from './workflow/workflow-layer.js';

const SERVICE_NAME = 'transaction-service';

/**
 * Where each participant is reached, and the crossing token it takes.
 *
 * ⚠️ **A crossing token per participant, and each is that participant's
 * own.** Reusing one across services — or reusing the fleet's
 * `CONFIG_SERVICE_TOKEN` — would make a single leaked secret a tenant-data
 * write capability everywhere at once. They are separate `is_secret` rows
 * with separate rotations (ADR 0023), and holding several is the
 * concentration ADR 0039 recorded rather than a new class of risk. The saga
 * runner and the flow engine present the same ones.
 */
/** The participant every fulfilment fragment calls. */
const FULFILMENT_PARTICIPANT = 'fulfilment-service';

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
 * The `transaction` slice's composition, mounted by its service alone (ADR 0064) — the `saga` store's only writer.
 *
 * **The pool plus a database the slice names**, not `MongoDatabaseLayer`.
 * That shape was chosen while this store was co-deployed inside
 * marketplace-admin-service, which held two Mongo stores, and it is what made
 * the split cheap: the handle was already an explicit `client.db(name)` rather
 * than "whatever the ambient database tag holds", so the store moved without a
 * line of its logic changing (#229) — and since #376 the name is handed to
 * `sagaStoresLayer`, entifix's saga store and the `saga/mongo` cell alike.
 *
 * **No outbox either.** An outbox entry is a `catalog` collection, one per
 * `tenant_<id>` database, written in the same Mongo transaction as the entity it
 * announces (ADR 0028) — so it belongs to the catalog's writer and stayed
 * there.
 */
export const transactionComposition =
  (runner: RunnerReplica) => (configuration: FleetConfiguration) =>
    Effect.gen(function* () {
      const { store } = configuration;

      const sagaDbName = yield* store.in('saga').getString('db');
      const sagaResumeIntervalMs = yield* store
        .in('saga')
        .getNumber('resumeIntervalMs');
      const sagaStaleAfterMs = yield* store
        .in('saga')
        .getNumber('resumeStaleAfterMs');
      const sagaMaxResumeAttempts = yield* store
        .in('saga')
        .getNumber('maxResumeAttempts');

      const participants = yield* readParticipants(configuration);

      const connections = Layer.mergeAll(
        // The pool: the `saga` store is a database this process names itself.
        yield* fleetMongoPoolLayer(configuration, ['saga']),
        // This slice's rows were named `amqp` before the rest of the fleet's.
        yield* fleetBusLayer(configuration, 'amqp'),
        yield* fleetSecurityLayer(configuration),
        // ⚠️ **This service's own *inbound* token — what a caller presents to run
        // a saga — and a different secret from the outbound ones above.** The
        // coordinator is both a callee and a caller, and collapsing the two
        // directions onto one value would mean anyone allowed to *start* a
        // checkout held the key that *writes* a vendor's stock.
        yield* crossingTokenLayer(configuration),
        Layer.succeed(SagaResumeIntervalMs, sagaResumeIntervalMs),
        Layer.succeed(SagaStaleAfterMs, sagaStaleAfterMs),
        Layer.succeed(SagaMaxResumeAttempts, sagaMaxResumeAttempts),
        Layer.succeed(ParticipantsTag, participants),
      );

      // A start's idempotency records live in the `saga` store's database.
      const idempotency = yield* fleetIdempotencyLayer(
        configuration,
        sagaDbName,
      );

      const infra = Layer.provideMerge(
        Layer.mergeAll(
          idempotency,
          sagaStoresLayer(sagaDbName),
          HttpSagaDispatcherLayer,
        ),
        connections,
      );

      // The durable flow engine, beside the saga runner until #490 deletes the
      // runner: replica 0's runner, on the bus this composition already opened.
      const workflow = Layer.provide(
        yield* workflowComposition(configuration, participants, runner),
        connections,
      );

      // ⚠️ Chained after the stores rather than merged beside them, so the
      // resume sweep is built on a context that already has the store and the
      // dispatcher.
      return Layer.merge(
        Layer.provideMerge(Layer.effectDiscard(startSagaResume), infra),
        workflow,
      );
    });

/**
 * A runner that serves no HTTP: a further replica of the flow engine, whose
 * shards are assigned in the `workflow` store the other runners registered
 * in (ADR 0066). It opens only what the engine needs — the bus its relay
 * publishes on — and none of the saga runner's stores, which replica 0 alone
 * holds until #490 deletes them.
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
