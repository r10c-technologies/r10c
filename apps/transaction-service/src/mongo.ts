import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  makeTransactionStreamHubEffect,
  TransactionStreamHubTag,
} from '@r10c/entifix-transactions';
import {
  AmqpEventBusLayer,
  AmqpHealthProbeLayer,
  AmqpLayer,
} from '@r10c/entifix-ts-amqp-client';
import {
  ConfigurationRepositoryTag,
  TokenServiceTag,
} from '@r10c/entifix-ts-business';
import { ConfigurationClientInMemory } from '@r10c/entifix-ts-core';
import { makeJoseTokenService } from '@r10c/entifix-ts-jwt-client';
import {
  MongoClientLayer,
  MongoHealthProbeLayer,
} from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
  observabilityFromConfiguration,
  ServiceCrossingTokenTag,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import {
  HttpSagaDispatcherLayer,
  type Participant,
  ParticipantsTag,
} from './saga/http-dispatcher';
import { MongoSagaStoreLayer } from './saga/instance-store';
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
} from './sagas/checkout.saga';

const SERVICE_NAME = 'transaction-service';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

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
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationClientInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const amqpUri = yield* store.in('amqp').getString('uri');
    const sagaDbName = yield* store.in('saga').getString('db');
    const sagaStaleTimeoutMs = yield* store
      .in('saga')
      .getNumber('staleTimeoutMs');
    const sagaRecoveryIntervalMs = yield* store
      .in('saga')
      .getNumber('recoveryIntervalMs');

    // The public half only. This service verifies access tokens and never mints
    // one, so it is configured with material that cannot sign.
    const jwtPublicKey = yield* store.in('jwt').getString('publicKey');
    const jwtKeyId = yield* store.in('jwt').getString('keyId');

    // ⚠️ **This service's own *inbound* token — what a caller presents to run a
    // saga — and it is a different secret from the outbound ones below. The
    // coordinator is both a callee and a caller, and collapsing the two
    // directions onto one value would mean anyone allowed to *start* a checkout
    // held the key that *writes* a vendor's stock.
    const inboundToken = yield* store.in('service').getString('token');

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

    const observability = yield* observabilityFromConfiguration(
      store,
      SERVICE_NAME,
    );

    const connections = Layer.mergeAll(
      MongoClientLayer({ uri }),
      AmqpLayer({ uri: amqpUri }),
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem: jwtPublicKey,
          keyId: jwtKeyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
      Layer.succeed(PolicyDecisionTag, makeStaticPolicyDecision()),
      Layer.succeed(SagaDatabaseName, sagaDbName),
      Layer.succeed(SagaStaleTimeoutMs, sagaStaleTimeoutMs),
      Layer.succeed(SagaRecoveryIntervalMs, sagaRecoveryIntervalMs),
      Layer.succeed(ServiceCrossingTokenTag, inboundToken),
      Layer.succeed(ParticipantsTag, participants),
    );

    const infra = Layer.provideMerge(
      Layer.mergeAll(
        AmqpEventBusLayer,
        MongoTransactionStoreLayer,
        MongoSagaStoreLayer,
        HttpSagaDispatcherLayer,
        // The in-process fan-out behind `GET /api/transaction/events`. Scoped,
        // so the connections it holds are released with the server, and shared
        // by the whole process: one bus subscription feeds every browser rather
        // than a broker queue per open tab, which would be a broker resource a
        // client controls.
        Layer.scoped(TransactionStreamHubTag, makeTransactionStreamHubEffect),
      ),
      connections,
    );

    // The logical Stores each connection backs, by their register name in
    // `tools/slices/` — one now, where the co-deployed process named two
    // (ADR 0031).
    const withProbes = Layer.provideMerge(
      Layer.mergeAll(MongoHealthProbeLayer(['saga']), AmqpHealthProbeLayer),
      infra,
    );

    return Layer.merge(
      observability,
      Layer.provideMerge(
        // The tracker: it subscribes to the bus and forks the recovery sweep.
        // Passive for a single-step write — it observes and recovers — while
        // `POST /api/saga/:definition` beside it dispatches. Both read the same
        // store, which is what makes "where did this stop, and what has been
        // reversed" one query rather than a correlation across service logs.
        Layer.effectDiscard(startTracking),
        withProbes,
      ),
    );
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
