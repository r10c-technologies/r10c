import { TransactionStreamHubTag } from '@entifix/transactions';
import { makeTransactionStreamHubEffect } from '@entifix/transactions/engine';
import {
  crossingTokenLayer,
  fleetBusLayer,
  fleetMongoPoolLayer,
  fleetSecurityLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  HttpSagaDispatcherLayer,
  type Participant,
  ParticipantsTag,
} from './saga/http-dispatcher';
import { MongoSagaStoreLayer } from './saga/instance-store';
import {
  SagaMaxResumeAttempts,
  SagaResumeIntervalMs,
  SagaStaleAfterMs,
  startSagaResume,
} from './saga/resume';
import { MongoTransactionStoreLayer, SagaDatabaseName } from './saga/store';
import {
  SagaRecoveryIntervalMs,
  SagaStaleTimeoutMs,
  startTracking,
} from './saga/tracking';
import {
  ORDER_PARTICIPANT,
  PAYMENT_PARTICIPANT,
  STOCK_PARTICIPANT,
} from './sagas';

const SERVICE_NAME = 'transaction-service';

/**
 * The transaction-service composition root — the `saga` store's only writer.
 *
 * **`MongoClientLayer` plus an explicit `SagaDatabaseName`**, not
 * `MongoDatabaseLayer`. That shape was chosen while this store was co-deployed
 * inside marketplace-admin-service, which held two Mongo stores, and it is what
 * made the split cheap: the handle was already an explicit `client.db(name)`
 * rather than "whatever the ambient database tag holds", so `saga/store.ts`
 * moved without a line of its logic changing (#229).
 *
 * **No Redis, and that is a boundary rather than an omission.** The locks and
 * sequences live in the `saga-coordination` store, which
 * `docs/_shared/planes.md` gives to the **marketplace-admin** slice — a similar
 * name for a different store with a different writer. Opening a Redis handle
 * here would put two slices on one store.
 *
 * **No outbox either.** An outbox entry is a `catalog` collection, one per
 * `tenant_<id>` database, written in the same Mongo transaction as the entity it
 * announces (ADR 0028) — so it belongs to the catalog's writer and stayed
 * there.
 */
export const AppLayer = makeFleetServiceLayer(SERVICE_NAME, configuration =>
  Effect.gen(function* () {
    const { store } = configuration;

    const sagaDbName = yield* store.in('saga').getString('db');
    const sagaStaleTimeoutMs = yield* store
      .in('saga')
      .getNumber('staleTimeoutMs');
    const sagaRecoveryIntervalMs = yield* store
      .in('saga')
      .getNumber('recoveryIntervalMs');
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
      Layer.succeed(SagaDatabaseName, sagaDbName),
      Layer.succeed(SagaStaleTimeoutMs, sagaStaleTimeoutMs),
      Layer.succeed(SagaRecoveryIntervalMs, sagaRecoveryIntervalMs),
      Layer.succeed(SagaResumeIntervalMs, sagaResumeIntervalMs),
      Layer.succeed(SagaStaleAfterMs, sagaStaleAfterMs),
      Layer.succeed(SagaMaxResumeAttempts, sagaMaxResumeAttempts),
      Layer.succeed(ParticipantsTag, participants),
    );

    const infra = Layer.provideMerge(
      Layer.mergeAll(
        MongoTransactionStoreLayer,
        MongoSagaStoreLayer,
        HttpSagaDispatcherLayer,
        // The in-process fan-out behind `GET /api/transaction/events`. Scoped,
        // so the connections it holds are released with the server, and shared
        // by the whole process: one bus subscription feeds every browser rather
        // than a broker queue per open tab, which would be a broker resource a
        // client controls.
        Layer.effect(TransactionStreamHubTag, makeTransactionStreamHubEffect),
      ),
      connections,
    );

    // The tracker: it subscribes to the bus and forks the recovery sweep.
    // Passive for a single-step write — it observes and recovers — while
    // `POST /api/saga/:definition` beside it dispatches. Both read the same
    // store, which is what makes "where did this stop, and what has been
    // reversed" one query rather than a correlation across service logs.
    const tracked = Layer.provideMerge(
      Layer.effectDiscard(startTracking),
      infra,
    );

    // ⚠️ Chained after the tracker rather than merged beside it, so the
    // resume sweep is built on a context that already has the store and the
    // dispatcher. Merged, the two forks would race for the same services at
    // boot.
    return Layer.provideMerge(Layer.effectDiscard(startSagaResume), tracked);
  }),
);
