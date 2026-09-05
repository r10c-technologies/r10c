import { matchesEventPattern } from '@r10c/entifix-ts-core';

/**
 * A fake of the amqplib channel, not of the {@link EventBus} port.
 *
 * `makeAmqpEventBus` runs on top of it, so the envelope framing, the
 * `prefetch(1)` the saga tracker depends on, and the ack/nack policy are
 * all exercised for real.
 */

export interface FakeAmqpMessage {
  content: Buffer;
}

export interface FakeAmqpChannel {
  /** Everything published, decoded from the wire. */
  readonly published: ReadonlyArray<{
    exchange: string;
    routingKey: string;
    body: unknown;
  }>;
  /**
   * Every queue binding the adapter asked for. Recorded because the exchange is
   * a topic now: the pattern a subscriber binds is the whole of its routing, so
   * a fake that swallowed it would let a wrong binding pass every test.
   */
  readonly bindings: ReadonlyArray<{
    queue: string;
    exchange: string;
    pattern: string;
  }>;
  /**
   * Every exchange the adapter declared, with its type. Recorded because the
   * dead-letter exchange is `direct` while the event exchange is `topic`, and a
   * broker will not retype an existing exchange — declaring the wrong type is a
   * failure that only appears against a real broker.
   */
  readonly exchanges: ReadonlyArray<{
    exchange: string;
    type: string;
    options: Record<string, unknown> | undefined;
  }>;
  /**
   * Every queue the adapter declared, with the arguments it declared it with.
   * The arguments *are* the delivery policy — `x-queue-type`,
   * `x-delivery-limit`, `x-dead-letter-exchange` — so a fake that swallowed
   * them would let a queue with no retry ceiling and no dead-letter path pass
   * every test, which is the exact defect ADR 0030 exists to close.
   */
  readonly queues: ReadonlyArray<{
    queue: string;
    options: Record<string, unknown> | undefined;
  }>;
  /** Messages acked, so the success policy can be asserted. */
  readonly acked: FakeAmqpMessage[];
  /**
   * Messages nacked, **with their flags**. `requeue` is the whole distinction
   * between a transient failure the broker should retry and a poison message it
   * should quarantine at once, so recording only that a nack happened is how
   * "dead-letters a failed message" stayed a passing test for a bus that
   * discarded it.
   */
  readonly nacked: ReadonlyArray<{
    message: FakeAmqpMessage;
    allUpTo: boolean;
    requeue: boolean;
  }>;
  /** The prefetch the adapter asked for — 1, or the fold races. */
  readonly prefetchCount: number | undefined;
  /**
   * The consumer tags cancelled, in order.
   *
   * Recorded rather than merely accepted because a graceful shutdown's first
   * phase *is* the cancel (ADR 0030): a connector that dropped the tag on the
   * floor would pass every test while leaving the broker delivering into a
   * process that is closing its connection.
   */
  readonly cancelled: readonly string[];
  /**
   * Pushes a message to the consumers whose binding matches it, as the broker
   * would. The routing key defaults to the envelope's own `meta.event.name`,
   * which is what the adapter publishes with.
   */
  deliver(body: unknown, routingKey?: string): Promise<void>;
  /** Pushes a raw payload, for malformed-message paths. */
  deliverRaw(payload: string): Promise<void>;
  /** Simulates the broker cancelling the consumer (amqplib delivers `null`). */
  deliverCancellation(): Promise<void>;
  /** Makes every subsequent channel call throw/reject with `error`. */
  failWith(error: unknown): void;
  /** The object to pass where an amqplib `Channel` is expected. */
  readonly channel: unknown;
}

/** The routing key a body would have been published with. */
const routingKeyOf = (body: unknown): string => {
  const event = (body as { meta?: { event?: { name?: unknown } } })?.meta
    ?.event;
  return typeof event?.name === 'string' ? event.name : '';
};

export const makeFakeAmqpChannel = (): FakeAmqpChannel => {
  const published: Array<{
    exchange: string;
    routingKey: string;
    body: unknown;
  }> = [];
  const bindings: Array<{ queue: string; exchange: string; pattern: string }> =
    [];
  const exchanges: Array<{
    exchange: string;
    type: string;
    options: Record<string, unknown> | undefined;
  }> = [];
  const queues: Array<{
    queue: string;
    options: Record<string, unknown> | undefined;
  }> = [];
  const acked: FakeAmqpMessage[] = [];
  const nacked: Array<{
    message: FakeAmqpMessage;
    allUpTo: boolean;
    requeue: boolean;
  }> = [];
  let consumer: ((message: FakeAmqpMessage | null) => void) | undefined;
  const cancelled: string[] = [];
  let consumerTags = 0;
  let boundQueue: string | undefined;
  let prefetchCount: number | undefined;
  let failure: unknown;

  const guard = () => {
    if (failure !== undefined) throw failure;
  };

  const channel = {
    publish: (exchange: string, routingKey: string, content: Buffer) => {
      guard();
      published.push({
        exchange,
        routingKey,
        body: JSON.parse(content.toString()) as unknown,
      });
      return true;
    },
    prefetch: async (count: number) => {
      guard();
      prefetchCount = count;
    },
    assertExchange: async (
      exchange: string,
      type: string,
      options?: Record<string, unknown>,
    ) => {
      guard();
      exchanges.push({ exchange, type, options });
      return { exchange };
    },
    assertQueue: async (queue: string, options?: Record<string, unknown>) => {
      guard();
      const name = queue === '' ? 'amq.gen-fake' : queue;
      queues.push({ queue: name, options });
      return { queue: name };
    },
    bindQueue: async (queue: string, exchange: string, pattern: string) => {
      guard();
      bindings.push({ queue, exchange, pattern });
    },
    consume: async (
      queue: string,
      handler: (message: FakeAmqpMessage | null) => void,
    ) => {
      guard();
      consumer = handler;
      boundQueue = queue;
      // A fresh tag per `consume`, so a reconnect's re-bind is distinguishable
      // from the binding it replaced — the connector cancels what it currently
      // holds, and a constant tag would hide it cancelling a stale one.
      consumerTags += 1;
      return { consumerTag: `fake-consumer-${consumerTags}` };
    },
    cancel: async (consumerTag: string) => {
      guard();
      cancelled.push(consumerTag);
      consumer = undefined;
    },
    ack: (message: FakeAmqpMessage) => {
      acked.push(message);
    },
    nack: (message: FakeAmqpMessage, allUpTo: boolean, requeue: boolean) => {
      nacked.push({ message, allUpTo, requeue });
    },
    close: async () => {
      guard();
    },
  };

  /**
   * The adapter acks/nacks from inside a floating promise chain, so a delivery
   * is only settled once the microtask queue drains.
   */
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  /**
   * Whether the consumer's queue is bound to a pattern matching `routingKey`.
   * The broker decides this in production, so the fake has to as well — without
   * it every subscriber sees every message and the topic exchange is untested.
   */
  const routes = (routingKey: string) =>
    bindings.some(
      binding =>
        binding.queue === boundQueue &&
        matchesEventPattern(binding.pattern, routingKey),
    );

  /**
   * `routingKey === undefined` means "the broker already routed this" — used by
   * the malformed-payload path, where the message reached the queue and it is
   * the *content* that is wrong.
   */
  const push = async (payload: string, routingKey: string | undefined) => {
    if (consumer === undefined) {
      throw new Error('fake amqp: nothing subscribed yet');
    }
    if (routingKey !== undefined && !routes(routingKey)) {
      return;
    }
    consumer({ content: Buffer.from(payload) });
    await settle();
  };

  return {
    get published() {
      return published;
    },
    get bindings() {
      return bindings;
    },
    get exchanges() {
      return exchanges;
    },
    get queues() {
      return queues;
    },
    get acked() {
      return acked;
    },
    get nacked() {
      return nacked;
    },
    get prefetchCount() {
      return prefetchCount;
    },
    get cancelled() {
      return cancelled;
    },
    deliver: (body, routingKey) =>
      push(JSON.stringify(body), routingKey ?? routingKeyOf(body)),
    deliverRaw: payload => push(payload, undefined),
    deliverCancellation: async () => {
      if (consumer === undefined) {
        throw new Error('fake amqp: nothing subscribed yet');
      }
      consumer(null);
      await settle();
    },
    failWith: error => {
      failure = error;
    },
    channel,
  };
};
