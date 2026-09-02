import { makeEventEnvelope } from '@r10c/entifix-ts-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEventSourceReactiveChannel } from './event-source-channel.js';

const URL = '/api/admin/transaction/events';

/**
 * jsdom implements no `EventSource` at all, so the transport under test has
 * nothing to open unless the spec supplies one. Minimal on purpose: this
 * asserts the channel's own wiring, not the browser's reconnect behaviour.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onmessage: ((message: { data: string }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  send(data: string) {
    this.onmessage?.({ data });
  }
}

const useFakeEventSource = () => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  return FakeEventSource;
};

const frame = (entity: string) =>
  JSON.stringify(
    makeEventEnvelope({
      name: 'transaction.completed',
      id: 'txn-1:completed',
      source: 'marketplace-admin',
      at: '2026-09-02T00:00:00.000Z',
      correlationId: 'txn-1',
      data: { entity, change: 'created', id: 'w-1' },
    }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('makeEventSourceReactiveChannel', () => {
  it('opens one connection for many listeners and delivers to all of them', () => {
    const source = useFakeEventSource();
    const channel = makeEventSourceReactiveChannel(URL);
    const a = vi.fn();
    const b = vi.fn();

    channel.subscribe(a);
    channel.subscribe(b);
    source.instances[0]?.send(frame('widget'));

    expect(source.instances).toHaveLength(1);
    expect(source.instances[0]?.url).toBe(URL);
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'txn-1',
        data: { entity: 'widget', change: 'created', id: 'w-1' },
      }),
    );
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('closes the connection when the last listener leaves, and reopens after', () => {
    const source = useFakeEventSource();
    const channel = makeEventSourceReactiveChannel(URL);

    const first = channel.subscribe(vi.fn());
    const second = channel.subscribe(vi.fn());
    first();
    expect(source.instances[0]?.closed).toBe(false);

    second();
    expect(source.instances[0]?.closed).toBe(true);

    channel.subscribe(vi.fn());
    expect(source.instances).toHaveLength(2);
  });

  it('stops delivering to a listener that unsubscribed', () => {
    const source = useFakeEventSource();
    const channel = makeEventSourceReactiveChannel(URL);
    const listener = vi.fn();
    const other = vi.fn();

    const unsubscribe = channel.subscribe(listener);
    channel.subscribe(other);
    unsubscribe();
    source.instances[0]?.send(frame('widget'));

    expect(listener).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  // `onmessage` runs inside the browser's event loop, where a throw reaches no
  // caller and would take the rest of this delivery's listeners with it.
  it.each([
    ['a frame that is not JSON', 'not json'],
    ['an envelope of the wrong type', '{"meta":{"type":"entity"},"data":{}}'],
    [
      'an event envelope missing its metadata',
      '{"meta":{"type":"event","event":{"name":"x"}},"data":{}}',
    ],
  ])('drops %s without throwing', (_label, payload) => {
    const source = useFakeEventSource();
    const channel = makeEventSourceReactiveChannel(URL);
    const listener = vi.fn();
    channel.subscribe(listener);

    expect(() => source.instances[0]?.send(payload)).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  // A channel built at module scope must not throw during a server pass.
  it('opens nothing where the runtime has no EventSource', () => {
    vi.stubGlobal('EventSource', undefined);
    const channel = makeEventSourceReactiveChannel(URL);

    expect(() => channel.subscribe(vi.fn())()).not.toThrow();
  });
});
