import type { DomainEvent, EntityChangeEvent } from '@r10c/entifix-ts-core';
import { describe, expect, it, vi } from 'vitest';

import {
  makeInMemoryReactiveChannel,
  NoopReactiveChannel,
} from './reactive-channel.js';

// The whole message, not the payload alone: the correlation id, the timestamp
// and the sequence live one level up rather than on the change (ADR 0036).
const event: DomainEvent<EntityChangeEvent> = {
  name: 'transaction.completed',
  id: 'txn-1:completed',
  source: 'marketplace-admin',
  at: '2026-09-02T00:00:00.000Z',
  correlationId: 'txn-1',
  data: { entity: 'widget', change: 'updated', id: 'w-1' },
};

describe('NoopReactiveChannel', () => {
  it('never emits and its unsubscribe is a no-op', () => {
    const unsubscribe = NoopReactiveChannel.subscribe(() => {
      throw new Error('should never be called');
    });

    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('makeInMemoryReactiveChannel', () => {
  it('fans an emitted event out to every subscriber', () => {
    const channel = makeInMemoryReactiveChannel();
    const a = vi.fn();
    const b = vi.fn();
    channel.subscribe(a);
    channel.subscribe(b);

    channel.emit(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('stops delivering to a listener after it unsubscribes', () => {
    const channel = makeInMemoryReactiveChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);

    unsubscribe();
    channel.emit(event);

    expect(listener).not.toHaveBeenCalled();
  });

  it('delivers nothing when there are no subscribers', () => {
    const channel = makeInMemoryReactiveChannel();

    expect(() => channel.emit(event)).not.toThrow();
  });
});
