import type { SubscriptionMode } from '@r10c/entifix-transactions';
import { Metric } from 'effect';

/**
 * The bus half of ADR 0001's first metric set.
 *
 * Counters rather than logs because a quarantined message that is only ever a
 * log line is indistinguishable from a dropped one when the question is *how
 * many*. Nothing here needs plumbing: `NodeSdk` wires the metric reader through
 * `@effect/opentelemetry`'s `Metrics.layer`, whose producer reads **Effect's own
 * global registry**, so an increment in any fiber — including the detached one
 * the AMQP consumer settles a delivery in — is exported.
 */

/**
 * ⚠️ These metric objects are **exported so a reader uses the same instance**.
 * An Effect metric's registry key includes its description, so
 * `Metric.counter('bus_events_published_total')` written out again — without the
 * description — addresses a *different* series that is always zero. That is a
 * silent way to write a dashboard query against nothing.
 */

/** Events handed to the broker, by event name. */
export const busEventsPublished = Metric.counter('bus_events_published_total', {
  description: 'Events accepted by the broker, by event name.',
});

/**
 * Publishes the broker refused, by event name.
 *
 * Separate from the outbox's own failure count on purpose: this one says the
 * broker would not take it, the outbox's says how many attempts that entry has
 * spent. One is a rate, the other is a backlog.
 */
export const busPublishFailures = Metric.counter('bus_publish_failures_total', {
  description: 'Publishes the broker refused, by event name.',
});

/** Deliveries whose handler completed and were acked, by subscription. */
export const busEventsConsumed = Metric.counter('bus_events_consumed_total', {
  description: 'Deliveries acked after their handler completed.',
});

/**
 * Deliveries that were nacked, by subscription and failure class.
 *
 * ⚠️ **This is not a dead-letter count, and cannot be.** `x-delivery-limit` is
 * what moves a message to `<queue>.quarantine`, and the broker does that without
 * telling the adapter — there is no in-process call site for it. A transient
 * failure on its fifth delivery is counted here exactly like its first. The
 * honest quarantine count on the publisher side is the outbox's; on this side,
 * a rising `failure="transient"` rate against a fixed `maxAttempts` is the
 * signal, and the quarantine queue's own depth is the confirmation.
 */
export const busEventsFailed = Metric.counter('bus_events_failed_total', {
  description:
    'Deliveries nacked, by subscription and failure class. Not a ' +
    'dead-letter count — the broker dead-letters without telling the adapter.',
});

/**
 * Identity of a subscription, as metric tags.
 *
 * `queue` is the durable work-queue name and so the only stable identity a
 * broadcast subscription does *not* have — its queue is anonymous and
 * regenerated per connection — which is why `slice` and `mode` are carried
 * beside it rather than derived from it.
 */
export interface SubscriptionTags {
  queue: string;
  slice: string;
  mode: SubscriptionMode;
}

const withSubscription = (
  metric: Metric.Metric.Counter<number>,
  tags: SubscriptionTags,
) =>
  metric.pipe(
    Metric.tagged('queue', tags.queue),
    Metric.tagged('slice', tags.slice),
    Metric.tagged('mode', tags.mode),
  );

/** Record one event accepted by the broker. */
export const recordPublished = (eventName: string) =>
  Metric.increment(Metric.tagged(busEventsPublished, 'event', eventName));

/** Record one publish the broker refused. */
export const recordPublishFailure = (eventName: string) =>
  Metric.increment(Metric.tagged(busPublishFailures, 'event', eventName));

/** Record one delivery acked after its handler completed. */
export const recordConsumed = (tags: SubscriptionTags) =>
  Metric.increment(withSubscription(busEventsConsumed, tags));

/**
 * Record one nacked delivery.
 *
 * `failure` is the class, never the event name: a poison message by definition
 * could not be parsed, so it has no `event.name` to attribute it to, and
 * dimensioning only the arm that has one would make the two counts
 * incomparable.
 */
export const recordFailed = (
  tags: SubscriptionTags,
  failure: 'transient' | 'poison',
) =>
  Metric.increment(
    Metric.tagged(withSubscription(busEventsFailed, tags), 'failure', failure),
  );
