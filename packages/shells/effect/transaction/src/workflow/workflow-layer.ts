import { NodeCrypto } from '@effect/platform-node';
import { PgClient } from '@effect/sql-pg';
import { HttpParticipantClientLayer } from '@entifix/rest/endpoint';
import { logMechanismOutcome } from '@entifix/service-shell';
import { SqlHealthProbeLayer } from '@entifix/sql';
import {
  ensureSqlTransactionTables,
  makeSqlOutbox,
  startSqlOutboxRelay,
} from '@entifix/sql/transactions';
import { CircuitBreakerTag, OutboxTag } from '@entifix/transactions';
import {
  InMemoryBulkheadLayer,
  InMemoryCircuitBreakerLayer,
} from '@entifix/transactions/engine';
import type { InterpreterOptions } from '@entifix/workflow';
import { SocketRunnerFlowEngineLayer } from '@entifix/workflow/socket-runner';
import {
  flowCatalog,
  flowParticipants,
} from '@r10c/shells-effect-flow-catalog';
import {
  type FleetConfiguration,
  fleetOutboxLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer, Redacted } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { SqlClient } from 'effect/sql';

import {
  type ParticipantDials,
  readAllParticipantDials,
} from './participant-dials.js';

/** The slice the engine's `flow.*` events are announced as (ADR 0029). */
/** One participant's address and the crossing token that reaches it. */
export interface Participant {
  readonly baseUrl: string;
  readonly crossingToken: string;
}

export const WORKFLOW_SOURCE = 'transaction';

/** The store the engine's journal, status and outbox live in. */
export const WORKFLOW_STORE = 'workflow';

/**
 * Where one replica's runner listens: the service port + 31000 + 1000 × its
 * index — `34103` and `35103` for transaction-service — so a runner port
 * never lands on another service's port, its inspector or a NodePort.
 */
export const runnerPort = (servicePort: number, replica: number) =>
  servicePort + 31_000 + 1_000 * replica;

/** Which runner a process is, and the service port its runner port derives from. */
export interface RunnerReplica {
  readonly servicePort: number;
  readonly replica: number;
}

/**
 * Each participant's breaker and bulkhead, sized by its own rows (ADR 0067).
 * A forced state is applied once the breaker exists, before any flow runs, so
 * an operator's `forcedOpen` holds from the first call. A key no row names —
 * a participant no registered fragment calls — runs on entifix's defaults.
 */
export const participantGuardsLayer = (
  dials: Readonly<Record<string, ParticipantDials>>,
) =>
  Layer.merge(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(CircuitBreakerTag, breaker =>
          Effect.forEach(
            Object.entries(dials),
            ([participant, { forcedState }]) =>
              forcedState === 'closed'
                ? Effect.void
                : breaker.force(participant, forcedState),
            { discard: true },
          ),
        ),
      ),
      InMemoryCircuitBreakerLayer({
        dialsFor: participant => dials[participant]?.breaker,
      }),
    ),
    InMemoryBulkheadLayer({
      permitsFor: participant => dials[participant]?.bulkheadPermits,
    }),
  );

/**
 * The engine's announcements, written into the `workflow` store's own outbox
 * in the same database as the journal; its tables are ensured at boot.
 */
export const SqlOutboxLayer = Layer.effect(
  OutboxTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* ensureSqlTransactionTables(sql);
    return makeSqlOutbox(sql);
  }),
);

/**
 * What the interpreter runs every slip with: r10c's catalog, this slice as
 * the source of its events, and each participant's own step bounds over the
 * engine's defaults.
 */
export const interpreterOptions = (
  dials: Readonly<Record<string, ParticipantDials>>,
  concurrency: number,
): InterpreterOptions => ({
  catalog: flowCatalog,
  source: WORKFLOW_SOURCE,
  dials: { concurrency },
  dialsFor: participant => dials[participant]?.bounds,
});

/**
 * The durable flow engine over the `workflow` store (ADR 0066), as one runner
 * among the replicas: its journal and shard locks in Postgres, each
 * participant behind a breaker and a bulkhead of its own (ADR 0067), its
 * announcements through an outbox in the same database and a relay onto the
 * bus. Needs the bus and the retry budget from the composition it joins.
 *
 * Every dial is read here, at boot, and every one is required — a missing row
 * is a boot that dies naming the key, not a participant quietly running on
 * defaults sized for nobody.
 */
export const workflowComposition = (
  configuration: FleetConfiguration,
  participants: Readonly<Record<string, Participant>>,
  runner: RunnerReplica,
) =>
  Effect.gen(function* () {
    const { store } = configuration;
    const url = yield* store.in('workflow').getString('url');
    const host = yield* store.in('workflow').getString('runnerHost');
    const concurrency = yield* store.in('flow').getNumber('concurrency');
    const dials = yield* readAllParticipantDials(store, flowParticipants());
    const announcing = yield* fleetOutboxLayer(configuration, WORKFLOW_SOURCE);

    const database = PgClient.layer({ url: Redacted.make(url) });
    const services = Layer.mergeAll(
      SqlOutboxLayer,
      participantGuardsLayer(dials),
      HttpParticipantClientLayer(
        Object.fromEntries(
          Object.entries(participants).map(([name, participant]) => [
            name,
            {
              baseUrl: participant.baseUrl,
              crossingToken: Redacted.make(participant.crossingToken),
            },
          ]),
        ),
      ).pipe(Layer.provide(FetchHttpClient.layer)),
      NodeCrypto.layer,
      announcing,
    );

    return Layer.mergeAll(
      SocketRunnerFlowEngineLayer(interpreterOptions(dials, concurrency), {
        host,
        port: runnerPort(runner.servicePort, runner.replica),
      }),
      // Every replica relays: the outbox's claim keeps them apart.
      Layer.effectDiscard(
        startSqlOutboxRelay({
          database: WORKFLOW_STORE,
          onOutcome: logMechanismOutcome,
        }),
      ),
      SqlHealthProbeLayer([WORKFLOW_STORE]),
    ).pipe(Layer.provideMerge(services), Layer.provideMerge(database));
  });
