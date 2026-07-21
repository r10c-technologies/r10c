/**
 * A fake of the amqplib channel, not of the {@link EventBus} port.
 *
 * `makeAmqpEventBus` runs on top of it, so the envelope framing, the
 * `prefetch(1)` the transaction-manager depends on, and the ack/nack policy are
 * all exercised for real.
 */

export interface FakeAmqpMessage {
  content: Buffer;
}

export interface FakeAmqpChannel {
  /** Everything published, decoded from the wire. */
  readonly published: ReadonlyArray<{ exchange: string; body: unknown }>;
  /** Messages acked and nacked, so the failure policy can be asserted. */
  readonly acked: FakeAmqpMessage[];
  readonly nacked: FakeAmqpMessage[];
  /** The prefetch the adapter asked for — 1, or the fold races. */
  readonly prefetchCount: number | undefined;
  /** Pushes a message to the registered consumer, as the broker would. */
  deliver(body: unknown): Promise<void>;
  /** Pushes a raw payload, for malformed-message paths. */
  deliverRaw(payload: string): Promise<void>;
  /** Simulates the broker cancelling the consumer (amqplib delivers `null`). */
  deliverCancellation(): Promise<void>;
  /** Makes every subsequent channel call throw/reject with `error`. */
  failWith(error: unknown): void;
  /** The object to pass where an amqplib `Channel` is expected. */
  readonly channel: unknown;
}

export const makeFakeAmqpChannel = (): FakeAmqpChannel => {
  const published: Array<{ exchange: string; body: unknown }> = [];
  const acked: FakeAmqpMessage[] = [];
  const nacked: FakeAmqpMessage[] = [];
  let consumer: ((message: FakeAmqpMessage | null) => void) | undefined;
  let prefetchCount: number | undefined;
  let failure: unknown;

  const guard = () => {
    if (failure !== undefined) throw failure;
  };

  const channel = {
    publish: (exchange: string, _routingKey: string, content: Buffer) => {
      guard();
      published.push({
        exchange,
        body: JSON.parse(content.toString()) as unknown,
      });
      return true;
    },
    prefetch: async (count: number) => {
      guard();
      prefetchCount = count;
    },
    assertExchange: async (exchange: string) => {
      guard();
      return { exchange };
    },
    assertQueue: async (queue: string) => {
      guard();
      return { queue: queue === '' ? 'amq.gen-fake' : queue };
    },
    bindQueue: async () => {
      guard();
    },
    consume: async (
      _queue: string,
      handler: (message: FakeAmqpMessage | null) => void,
    ) => {
      guard();
      consumer = handler;
      return { consumerTag: 'fake-consumer' };
    },
    ack: (message: FakeAmqpMessage) => {
      acked.push(message);
    },
    nack: (message: FakeAmqpMessage) => {
      nacked.push(message);
    },
    close: async () => {
      guard();
    },
  };

  /**
   * The adapter acks/nacks from inside a floating promise chain, so a delivery
   * is only settled once the microtask queue drains.
   */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const push = async (payload: string) => {
    if (consumer === undefined) {
      throw new Error('fake amqp: nothing subscribed yet');
    }
    consumer({ content: Buffer.from(payload) });
    await settle();
  };

  return {
    get published() {
      return published;
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
    deliver: (body) => push(JSON.stringify(body)),
    deliverRaw: (payload) => push(payload),
    deliverCancellation: async () => {
      if (consumer === undefined) {
        throw new Error('fake amqp: nothing subscribed yet');
      }
      consumer(null);
      await settle();
    },
    failWith: (error) => {
      failure = error;
    },
    channel,
  };
};
