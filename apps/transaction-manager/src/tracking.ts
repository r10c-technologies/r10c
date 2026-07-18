import {
  EventBusTag,
  TransactionStoreTag,
} from '@r10c/entifix-transactions';
import { Duration, Effect } from 'effect';

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

  // Fold each observed event into the persisted record. The handler carries no
  // requirements (store is closed over), so the bus can run it standalone.
  yield* bus.subscribe((event) => Effect.asVoid(store.upsertFromEvent(event)));

  // Recovery sweep as a detached daemon so it outlives the boot effect.
  const sweep = Effect.gen(function* () {
    const stale = yield* store.findStale(STALE_TIMEOUT_MS);
    yield* Effect.forEach(stale, (record) => store.markStale(record.transactionId), {
      discard: true,
    });
  }).pipe(
    // A sweep failure must not kill the loop — log-and-continue.
    Effect.catchAll(() => Effect.void),
    Effect.delay(RECOVERY_INTERVAL),
    Effect.forever,
  );

  yield* Effect.forkDaemon(sweep);
});
