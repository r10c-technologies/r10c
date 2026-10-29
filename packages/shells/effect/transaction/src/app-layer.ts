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

const SERVICE_NAME = 'transaction-service';

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
export const transactionComposition = (configuration: FleetConfiguration) =>
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

    // ⚠️ **A crossing token per participant, and each is that participant's
    // own.** Reusing one across services — or reusing the fleet's
    // `CONFIG_SERVICE_TOKEN` — would make a single leaked secret a tenant-data
    // write capability everywhere at once. They are separate `is_secret` rows
    // with separate rotations (ADR 0023), and holding several is the
    // concentration ADR 0039 recorded rather than a new class of risk.
    const participants: Readonly<Record<string, Participant>> = {
      [STOCK_PARTICIPANT]: {
        baseUrl: yield* store.in('participant').getString('stockUrl'),
        crossingToken: yield* store.in('participant').getString('stockToken'),
      },
      [ORDER_PARTICIPANT]: {
        baseUrl: yield* store.in('participant').getString('orderUrl'),
        crossingToken: yield* store.in('participant').getString('orderToken'),
      },
      [PAYMENT_PARTICIPANT]: {
        baseUrl: yield* store.in('participant').getString('paymentUrl'),
        crossingToken: yield* store.in('participant').getString('paymentToken'),
      },
    };

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
    const idempotency = yield* fleetIdempotencyLayer(configuration, sagaDbName);

    const infra = Layer.provideMerge(
      Layer.mergeAll(
        idempotency,
        sagaStoresLayer(sagaDbName),
        HttpSagaDispatcherLayer,
      ),
      connections,
    );

    // ⚠️ Chained after the stores rather than merged beside them, so the
    // resume sweep is built on a context that already has the store and the
    // dispatcher.
    return Layer.provideMerge(Layer.effectDiscard(startSagaResume), infra);
  });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = () =>
  makeFleetServiceLayer(SERVICE_NAME, transactionComposition);
