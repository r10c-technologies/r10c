import {
  EventBusTag,
  type TransactionEvent,
  TransactionStoreTag,
  TransactionStreamHubTag,
} from '@r10c/entifix-transactions';
import type { DomainEvent } from '@r10c/entifix-ts-core';
import { Duration, Effect } from 'effect';

/**
 * The slice this consumer belongs to, and half of its queue's name.
 *
 * **Not** `marketplace-admin`, which is what this *process* publishes as: the
 * tracker is the `transaction` slice, co-deployed here by ADR 0021. Naming its
 * queue after the host would file it under whoever happens to share the
 * process, and splitting the slice back out to `:3103` would then rename a
 * durable queue — abandoning whatever was still in it.
 *
 * A literal because `tools/slices/` is a tools project and not importable from
 * an app; the same duplication `ROLE_PERMISSIONS` carries, and the reason
 * `@r10c/slices` checks the declaration rather than trusting it.
 */
const TRACKER_SLICE = 'transaction';

/**
 * Deliveries the broker allows before dead-lettering, mirroring
 * `tools/slices/src/slices/transaction.slice.ts`.
 *
 * Deliberately **not** read from config-service, unlike the outbox relay's
 * ceiling. This value becomes the queue's `x-delivery-limit`, which is
 * immutable once the queue exists — an operator who edited it would change a
 * number nothing adopts, and the redeclaration would fail
 * `PRECONDITION_FAILED`. A tunable you cannot tune is worse than a constant.
 */
const MAX_ATTEMPTS = 5;

/** How often the recovery sweep runs. */
const RECOVERY_INTERVAL = Duration.seconds(10);
/**
 * A non-terminal transaction older than this is presumed stuck. Kept well above
 * the worst-case time a command spends queued behind the per-type resource lock,
 * so a merely-slow transaction is not mistaken for a stalled one.
 */
const STALE_TIMEOUT_MS = 60_000;

/**
 * The manager's passive role: subscribe to the bus and fold every event into
 * the store, and run a recovery sweep that flags transactions stuck in a
 * non-terminal state. It never dispatches work — choreography lives in the
 * services; the manager only observes and recovers.
 */
export const startTracking = Effect.gen(function* () {
  const store = yield* TransactionStoreTag;
  const bus = yield* EventBusTag;
  const hub = yield* TransactionStreamHubTag;

  // Fold each observed event into the persisted record. The handler carries no
  // requirements (store is closed over), so the bus can run it standalone.
  // `transaction.*` and nothing else: the exchange is a topic, so this slice's
  // interest is expressed to the broker rather than in the handler. It is the
  // same string `tools/slices/transaction.slice.ts` declares, which is what
  // keeps the register honest.
  //
  // `work`, not `broadcast`: the fold is an idempotent upsert that wants to
  // reach exactly one replica, and — the half that actually bit — it must not
  // lose an event published while this process is restarting. On the exclusive
  // queue this used to bind, such an event was routed to zero queues and
  // dropped by the broker, while the outbox had already recorded it sent
  // (ADR 0030).
  yield* bus.subscribe(
    {
      slice: TRACKER_SLICE,
      pattern: 'transaction.*',
      mode: 'work',
      maxAttempts: MAX_ATTEMPTS,
    },
    event =>
      Effect.asVoid(store.upsertFromEvent(event.data as TransactionEvent)),
  );

  // The same events again, on a second subscription, feeding the connections
  // held by `GET /api/transaction/events`.
  //
  // **`broadcast`, and it is not interchangeable with the fold above.** Every
  // replica holds *different* browser connections, so every replica must receive
  // every event; a `work` queue delivers each one to exactly one replica and the
  // clients attached to the others silently never learn — which reads as
  // flakiness rather than as a defect, because nothing errors. This is the
  // consumer ADR 0030 named by number when it declined to make broadcast the
  // default, and the first one in the register.
  //
  // Two subscriptions on one slice and one pattern do not collide: only a `work`
  // queue is named (`queueNameFor`), and a broadcast queue is an anonymous
  // exclusive one that dies with its connection — correct here, since a message
  // published while a replica restarts has no audience anyway.
  yield* bus.subscribe(
    {
      slice: TRACKER_SLICE,
      pattern: 'transaction.*',
      mode: 'broadcast',
      maxAttempts: MAX_ATTEMPTS,
    },
    event => hub.publish(event as DomainEvent<TransactionEvent>),
  );

  // Recovery sweep as a detached daemon so it outlives the boot effect.
  const sweep = Effect.gen(function* () {
    const stale = yield* store.findStale(STALE_TIMEOUT_MS);
    yield* Effect.forEach(
      stale,
      record => store.markStale(record.transactionId),
      {
        discard: true,
      },
    );
  }).pipe(
    // A sweep failure must not kill the loop — log-and-continue.
    Effect.catchAll(() => Effect.void),
    Effect.delay(RECOVERY_INTERVAL),
    Effect.forever,
  );

  yield* Effect.forkDaemon(sweep);
});
