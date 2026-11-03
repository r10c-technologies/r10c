import { EventBusTag, type Subscription } from '@entifix/transactions';
import { Effect } from 'effect';

import { PUSH_PROJECTIONS } from './push-projections.js';
import { RealtimePushTag } from './realtime-push.js';

/** The slice this service subscribes as (ADR 0029). */
export const REALTIME_SLICE = 'realtime';

/**
 * Declared and unenforced on a `broadcast` queue, which has no dead-letter
 * path; kept at the fleet budget so the register reads one number everywhere.
 */
const MAX_ATTEMPTS = 5;

/**
 * One subscription per projected event, each a **`broadcast`**: every replica
 * holds different connections, so every replica must see every message, and a
 * message missed while a replica was down is caught up by the browser's
 * `resync` rather than by a durable queue
 * ([ADR 0030](../../../../../docs/adr/0030-failure-retry-and-quarantine-on-the-bus.md),
 * [ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 */
export const pushSubscription = (pattern: string): Subscription => ({
  slice: REALTIME_SLICE,
  pattern,
  mode: 'broadcast',
  maxAttempts: MAX_ATTEMPTS,
});

/** Binds every projected event to this replica's push hub. */
export const startPushSubscriptions = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const push = yield* RealtimePushTag;
  for (const pattern of Object.keys(PUSH_PROJECTIONS)) {
    yield* bus.subscribe(pushSubscription(pattern), event =>
      push.publish(event).pipe(Effect.withSpan(`realtime.push.${pattern}`)),
    );
  }
});
