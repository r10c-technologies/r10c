import { queueNameFor } from '@entifix/amqp/transactions';
import { EventBusTag, type Subscription } from '@entifix/transactions';
import {
  type FlowStatusApplied,
  flowStatusFromEvent,
  FlowStatusStoreTag,
} from '@r10c/business-ts-flow-contracts';
import { logSliceOutcome } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { REALTIME_SLICE } from './push-subscriptions.js';

/** Redeliveries before a flow event this slice cannot project is quarantined. */
const MAX_ATTEMPTS = 5;

/**
 * The one **`work`** subscription: the flow-status projection must be written
 * once, whichever replica receives the message, where every push subscription
 * is a broadcast (ADR 0072).
 */
export const FLOW_STATUS_SUBSCRIPTION: Subscription = {
  slice: REALTIME_SLICE,
  pattern: 'flow.*',
  mode: 'work',
  maxAttempts: MAX_ATTEMPTS,
};

/** What one apply did, logged at the consumer — the fork site (ADR 0064). */
export const logFlowStatus = (
  event: string,
  flowId: string,
  outcome: FlowStatusApplied,
) =>
  logSliceOutcome(outcome === 'applied' ? 'Info' : 'Debug', 'flow status', {
    outcome:
      outcome === 'applied'
        ? 'applied'
        : outcome === 'stale'
          ? 'olderVersion'
          : 'alreadyApplied',
    event,
    flowId,
  });

/**
 * Projects every `flow.*` event into the store. The message is claimed by its
 * `event.id` in the same unit as the write, and an older version is discarded,
 * so a redelivery and an out-of-order delivery both leave one current record.
 * A payload that does not decode fails typed, and redelivery quarantines it.
 */
export const startFlowStatusProjection = Effect.gen(function* () {
  const bus = yield* EventBusTag;
  const store = yield* FlowStatusStoreTag;
  const consumer = queueNameFor(FLOW_STATUS_SUBSCRIPTION);
  yield* bus.subscribe(FLOW_STATUS_SUBSCRIPTION, event =>
    flowStatusFromEvent(event).pipe(
      Effect.flatMap(record =>
        Effect.flatMap(
          store.apply(record, { consumer, eventId: event.id }),
          outcome => logFlowStatus(event.name, record.flowId, outcome),
        ),
      ),
      Effect.withSpan(`realtime.flow-status.${event.name}`),
    ),
  );
});
