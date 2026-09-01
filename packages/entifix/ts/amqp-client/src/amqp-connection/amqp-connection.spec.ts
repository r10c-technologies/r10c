import { EntifixConnError } from '@r10c/entifix-ts-core';
import type * as amqp from 'amqplib';
import { Cause, Effect, Exit, Option } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AmqpLayer,
  EVENTS_DLX,
  EVENTS_EXCHANGE,
  makeAmqpConnector,
} from './amqp-connection.js';

const connect = vi.hoisted(() => vi.fn());
vi.mock('amqplib', () => ({ connect }));

/**
 * A connection whose lifecycle events can be fired on demand, which is the only
 * way to reach the reconnect paths: `amqplib` signals a dead broker by emitting
 * `close`/`error` rather than by failing the next call.
 */
const makeFakeConnection = () => {
  const handlers = new Map<string, Array<() => void>>();
  const on = (event: string, handler: () => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  };
  const emit = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler();
  };

  const channel = {
    assertExchange: vi.fn(() => Promise.resolve({})),
    on,
    publish: vi.fn(),
  } as unknown as amqp.Channel & { publish: ReturnType<typeof vi.fn> };

  const connection = {
    createChannel: vi.fn(() => Promise.resolve(channel)),
    close: vi.fn(() => Promise.resolve()),
    on,
  } as unknown as amqp.ChannelModel;

  return { connection, channel, emitConnection: emit };
};

beforeEach(() => {
  connect.mockReset();
});

describe('makeAmqpConnector', () => {
  it('asserts both exchanges on connect, so publishers can assume them', async () => {
    const fake = makeFakeConnection();
    connect.mockResolvedValue(fake.connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);

    // Asserted as a pair, in order, rather than with two `toHaveBeenCalledWith`
    // checks that would each pass on the other's call. The **types** are the
    // load-bearing half: a broker will not retype an existing exchange, so a
    // `topic` dead-letter exchange is a mistake nothing can undo in place —
    // the same reason 0029's fanout was abandoned rather than migrated.
    expect(fake.channel.assertExchange).toHaveBeenCalledTimes(2);
    expect(fake.channel.assertExchange).toHaveBeenNthCalledWith(
      1,
      EVENTS_EXCHANGE,
      'topic',
      { durable: true },
    );
    // `direct`, because a quarantine routes on the *queue's* name, not the
    // event's.
    expect(fake.channel.assertExchange).toHaveBeenNthCalledWith(
      2,
      EVENTS_DLX,
      'direct',
      { durable: true },
    );
  });

  it('opens once and reuses the channel across calls', async () => {
    connect.mockResolvedValue(makeFakeConnection().connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);
    await connector.withChannel(async () => undefined);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  // The bug this whole type exists for: amqplib never reconnects, so a channel
  // opened at boot is dead forever once the broker restarts — and with it every
  // publish and every subscriber, silently.
  it('reopens after the broker drops the connection', async () => {
    const first = makeFakeConnection();
    const second = makeFakeConnection();
    connect.mockResolvedValueOnce(first.connection);
    connect.mockResolvedValueOnce(second.connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);
    first.emitConnection('close');
    await connector.withChannel(async () => undefined);

    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('reopens when the connection errors rather than closes', async () => {
    const first = makeFakeConnection();
    connect.mockResolvedValueOnce(first.connection);
    connect.mockResolvedValueOnce(makeFakeConnection().connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);
    first.emitConnection('error');
    await connector.withChannel(async () => undefined);

    expect(connect).toHaveBeenCalledTimes(2);
  });

  // A publish can race a broker restart: the channel was live when it was
  // handed over and dead by the time it was written to.
  it('retries once against a fresh channel when the call fails', async () => {
    connect.mockResolvedValueOnce(makeFakeConnection().connection);
    connect.mockResolvedValueOnce(makeFakeConnection().connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    let attempts = 0;
    const result = await connector.withChannel(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('channel closed');
      return 'sent';
    });

    expect(result).toBe('sent');
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it('surfaces a second consecutive failure rather than looping', async () => {
    connect.mockResolvedValue(makeFakeConnection().connection);

    const { connector } = makeAmqpConnector('amqp://localhost');

    await expect(
      connector.withChannel(async () => {
        throw new Error('broker gone');
      }),
    ).rejects.toThrow('broker gone');
  });

  // Without this a subscriber is silently dead after any outage: its exclusive
  // queue went away with the old connection and nothing rebinds it.
  it('re-runs registered consumers against the new channel after a reconnect', async () => {
    const first = makeFakeConnection();
    const second = makeFakeConnection();
    connect.mockResolvedValueOnce(first.connection);
    connect.mockResolvedValueOnce(second.connection);

    const { connector } = makeAmqpConnector('amqp://localhost');
    const boundTo: unknown[] = [];
    await connector.addConsumer(async channel => {
      boundTo.push(channel);
    });

    first.emitConnection('close');
    await connector.withChannel(async () => undefined);

    expect(boundTo).toEqual([first.channel, second.channel]);
  });

  // A burst of publishes arriving together after an outage must not each open
  // their own connection, leaving orphans that each re-register the consumers.
  it('opens once when several calls race a reconnect', async () => {
    connect.mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(() => resolve(makeFakeConnection().connection), 5),
        ),
    );

    const { connector } = makeAmqpConnector('amqp://localhost');
    await Promise.all([
      connector.withChannel(async () => undefined),
      connector.withChannel(async () => undefined),
      connector.withChannel(async () => undefined),
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('closes the underlying connection and refuses further use', async () => {
    const fake = makeFakeConnection();
    connect.mockResolvedValue(fake.connection);

    const { connector, close } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);
    await close();

    expect(fake.connection.close).toHaveBeenCalled();
    await expect(connector.withChannel(async () => undefined)).rejects.toThrow(
      /closed/,
    );
  });

  it('does not retry a failing call once closed', async () => {
    const fake = makeFakeConnection();
    connect.mockResolvedValue(fake.connection);

    const { connector, close } = makeAmqpConnector('amqp://localhost');
    await connector.withChannel(async () => undefined);

    await expect(
      connector.withChannel(async () => {
        await close();
        throw new Error('mid-flight shutdown');
      }),
    ).rejects.toThrow('mid-flight shutdown');
  });

  it('closing before anything connected is a no-op', async () => {
    const { close } = makeAmqpConnector('amqp://localhost');

    await expect(close()).resolves.toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('AmqpLayer', () => {
  // Connecting eagerly keeps the old failure mode: an unreachable broker must
  // still stop the service booting, not leave it up with a silently dead bus.
  it('fails the layer when the broker is unreachable at boot', async () => {
    connect.mockRejectedValue(new Error('ECONNREFUSED'));

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.provide(Effect.void, AmqpLayer({ uri: 'amqp://x' })),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.failureOption(exit.cause))
      : undefined;
    expect(String(failure)).toContain('Failed to connect to RabbitMQ');
  });

  it('provides a connector and closes it on release', async () => {
    const fake = makeFakeConnection();
    connect.mockResolvedValue(fake.connection);

    await Effect.runPromise(
      Effect.scoped(
        Effect.provide(Effect.void, AmqpLayer({ uri: 'amqp://localhost' })),
      ),
    );

    expect(fake.connection.close).toHaveBeenCalled();
  });

  it('maps a boot failure onto EntifixConnError', async () => {
    connect.mockRejectedValue(new Error('ECONNREFUSED'));

    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.provide(Effect.void, AmqpLayer({ uri: 'amqp://x' })),
      ),
    );

    const failure = Exit.isFailure(exit)
      ? Option.getOrUndefined(Cause.failureOption(exit.cause))
      : undefined;
    expect(failure).toBeInstanceOf(EntifixConnError);
  });
});
