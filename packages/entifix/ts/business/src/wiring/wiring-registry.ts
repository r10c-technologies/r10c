import { Context, Effect, Layer, Ref } from 'effect';

/**
 * The queue shapes a subscriber may ask for (ADR 0030).
 *
 * Duplicated from `SubscriptionMode` in `@r10c/entifix-transactions` rather than
 * imported: that package sits at `entifix:transactions`, **above** this one at
 * `entifix:contract`, so the edge would point upward and the boundary rule fails
 * the build on it. The same duplication exists in `tools/slices/src/types.ts`
 * for the same reason, and both lists are pinned by a spec.
 */
export const BOUND_SUBSCRIPTION_MODES = ['work', 'broadcast'] as const;

export type BoundSubscriptionMode = (typeof BOUND_SUBSCRIPTION_MODES)[number];

/**
 * One subscription a running process **actually bound**, recorded by the bus
 * adapter as `subscribe` runs.
 *
 * Observed rather than declared, which is the whole point: a document generated
 * from `tools/slices/` would agree with `tools/slices/` by construction and
 * catch nothing (ADR 0031). `queue` is the broker's own name for it, so someone
 * looking at depth in the management UI can match the two up.
 */
export interface BoundSubscription {
  /** The **subscribing** slice — never the emitter. See `Subscription.slice`. */
  readonly slice: string;
  readonly pattern: string;
  readonly mode: BoundSubscriptionMode;
  readonly queue: string;
}

/**
 * What a process did with its bus, as opposed to what it can still reach.
 *
 * A sibling of `HealthRegistry` rather than part of it: a subscription is not a
 * readiness fact — a bound queue says nothing about whether the broker is
 * answering right now — and folding the two together would put entries in the
 * readiness response that no probe can check.
 *
 * Both halves are cumulative and never cleared. `published` is a set of event
 * **names** and nothing else: no payloads, no counts, no timestamps. Counts
 * would be per-replica and un-alertable, which is the telemetry path ADR 0001
 * already chose OTLP for.
 */
export interface WiringRegistry {
  /** Called by the bus adapter once per binding, including after a reconnect. */
  readonly recordSubscription: (
    bound: BoundSubscription,
  ) => Effect.Effect<void>;
  /** Called by the bus adapter on every publish. Idempotent per name. */
  readonly recordPublish: (eventName: string) => Effect.Effect<void>;
  /** Every distinct binding, in the order it was first made. */
  readonly subscriptions: Effect.Effect<readonly BoundSubscription[]>;
  /** Every distinct event name emitted since boot, in first-seen order. */
  readonly published: Effect.Effect<readonly string[]>;
}

/**
 * DI tag for the wiring registry.
 *
 * It lives here, in the contract layer, so `entifix-ts-amqp-client` can record
 * into it without depending on a shell — the same placement, and the same
 * reason, as {@link HealthRegistryTag}.
 */
export class WiringRegistryTag extends Context.Tag('WiringRegistryTag')<
  WiringRegistryTag,
  WiringRegistry
>() {}

/** Whether two bindings are the same binding. */
const same = (a: BoundSubscription, b: BoundSubscription): boolean =>
  a.slice === b.slice &&
  a.pattern === b.pattern &&
  a.mode === b.mode &&
  a.queue === b.queue;

/**
 * Live registry over a `Ref`. Provide it **once** per service and share the
 * instance (`Layer.provideMerge`), or the bus records into a registry the
 * description route never reads.
 *
 * Both recorders deduplicate. A reconnect re-runs every consumer's setup
 * against the new channel (`AmqpConnector.addConsumer`), so without it a broker
 * restart would list the same binding twice; and a publisher emits the same
 * event name continuously, so without it the list would grow without bound.
 */
export const WiringRegistryLayer: Layer.Layer<WiringRegistryTag> = Layer.effect(
  WiringRegistryTag,
  Effect.gen(function* () {
    const subscriptions = yield* Ref.make<readonly BoundSubscription[]>([]);
    const published = yield* Ref.make<readonly string[]>([]);

    return {
      recordSubscription: bound =>
        Ref.update(subscriptions, current =>
          current.some(existing => same(existing, bound))
            ? current
            : [...current, bound],
        ),

      recordPublish: eventName =>
        Ref.update(published, current =>
          current.includes(eventName) ? current : [...current, eventName],
        ),

      subscriptions: Ref.get(subscriptions),
      published: Ref.get(published),
    };
  }),
);
