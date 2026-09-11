import { AccountRepositoryTag } from '@r10c/business-ts-authn';
import {
  SessionStoreTag,
  ShutdownRegistryTag,
} from '@r10c/entifix-ts-business';
import {
  PROVIDER_USER_LIFECYCLE_EVENTS,
  ZitadelManagementTag,
} from '@r10c/entifix-ts-zitadel-client';
import { Context, Duration, Effect, Fiber } from 'effect';

import { LifecycleCursorTag } from './lifecycle-cursor';

/** Events read per pass. A ceiling, not a target — this runs on an interval. */
const BATCH = 200;

/** How often the reconciler asks what it missed. */
export class LifecycleSweepIntervalMs extends Context.Tag(
  'LifecycleSweepIntervalMs',
)<LifecycleSweepIntervalMs, number>() {}

/**
 * Revoke the r10c sessions of every user named by a lifecycle event since the
 * cursor, and record how far we got.
 *
 * Returns the number of events acted on, so a pass that found something is
 * visible in the log and a quiet one stays quiet.
 */
export const reconcileOnce = Effect.gen(function* () {
  const zitadel = yield* ZitadelManagementTag;
  const cursor = yield* LifecycleCursorTag;
  const sessions = yield* SessionStoreTag;
  const accounts = yield* AccountRepositoryTag;

  const since = yield* cursor.read;
  const events = yield* zitadel.searchEvents({
    eventTypes: PROVIDER_USER_LIFECYCLE_EVENTS,
    since,
    limit: BATCH,
  });
  if (events.length === 0) return 0;

  for (const event of events) {
    // The same two steps the webhook takes, deliberately: the provider names a
    // subject, and what r10c revokes is the account that subject maps to. A
    // second way of ending a session is a second thing to keep correct.
    const user = yield* accounts.findByIdentifier(event.subject);
    if (user === null || user.id === undefined) continue;
    yield* sessions.revokeAllForUser(String(user.id));
  }

  // The newest event's own timestamp, not `now`. Stamping the clock would skip
  // anything the instance recorded while this pass was running.
  const newest = events[events.length - 1];
  if (newest !== undefined) yield* cursor.write(newest.createdAt);

  yield* Effect.logInfo(
    `reconciled ${String(events.length)} provider lifecycle events`,
  );
  return events.length;
});

/**
 * The backstop for the window the webhook cannot cover.
 *
 * `POST /api/auth/provider-events` stays the primary mechanism and is not
 * touched: it closes the measured hole and it is fast. What it cannot do is
 * survive its own absence — Zitadel's Actions v2 target is `restAsync`, so the
 * instance sends the call, ignores the response and never retries. An event
 * fired while this process is down is gone, and that user's sessions live to
 * their seven-day ceiling exactly as before the webhook existed
 * ([ADR 0019](../../../../docs/adr/0019-provider-user-lifecycle-events-revoke-sessions.md)).
 *
 * In this lab that is not an edge case. auth-service runs as a host process and
 * the fleet is routinely up while it is not.
 *
 * ⚠️ **On boot and then on a slow interval — never on `refresh`.**
 * [ADR 0017](../../../../docs/adr/0017-back-channel-logout-from-the-identity-provider.md)
 * rejected polling the provider on refresh for a reason that still holds: it
 * couples session renewal to provider availability, so a Zitadel outage would
 * stop everyone refreshing. A daemon that fails alone degrades to the behaviour
 * we already had.
 *
 * A failed pass logs and lives, like the reservation sweep it is modelled on. It
 * holds no lock and claims nothing, which is safe for the same reason the
 * overlap is: every effect is a revoke, and revoking a revoked session is a
 * no-op, so two replicas sweeping together cost duplicate work and nothing else.
 */
export const startLifecycleReconciler = Effect.gen(function* () {
  const intervalMs = yield* LifecycleSweepIntervalMs;
  const shutdown = yield* ShutdownRegistryTag;

  const pass = reconcileOnce.pipe(
    Effect.catchAll(error =>
      Effect.logError(
        `provider lifecycle reconciliation failed: ${String(error)}`,
      ).pipe(Effect.as(0)),
    ),
  );

  // Boot first, then the interval: the gap this closes is precisely the one
  // that opened while the process was not running, so waiting a full interval
  // before looking would leave it open for exactly as long as it matters most.
  yield* pass;

  const daemon = yield* Effect.forkDaemon(
    pass.pipe(Effect.delay(Duration.millis(intervalMs)), Effect.forever),
  );

  // `stop-intake`, not `flush`: this sweep revokes sessions rather than
  // draining work, so there is nothing in flight for it to finish and no reason
  // to hold shutdown open for a provider round trip.
  yield* shutdown.register({
    name: 'lifecycle-reconciler',
    phase: 'stop-intake',
    run: Fiber.interrupt(daemon),
  });
});
