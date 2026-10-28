import { describe, expect, it } from 'vitest';

import { catalogSubscription } from './publish-catalog.js';

/**
 * The ordering guard itself is the published-catalog cell's, and its spec is
 * there (`packages/implementation/published-catalog/mongo`). What stays here is
 * the subscription this slice binds, whose shape is what keeps both names in
 * one order.
 */

describe('the subscription this slice binds', () => {
  it('binds one pattern covering both names, so they share an order', () => {
    // Two subscriptions would be two queues delivering independently, which is
    // exactly how a redelivered unpublication overtakes the publication that
    // superseded it. One queue, one order.
    expect(catalogSubscription.pattern).toBe('catalog.*');
  });

  it('names the subscribing slice, never the emitter', () => {
    // `queueNameFor` files the durable queue under this. One deployment hosts
    // several slices, so the publisher's name would file this consumer's
    // backlog under whoever shares its process.
    expect(catalogSubscription.slice).toBe('marketplace');
  });

  it('takes a durable work queue, because a lost message is an invisible gap', () => {
    // The projection is this slice's system of record for the published
    // catalog. A broadcast queue is anonymous and dies with its connection, so
    // anything published while the service restarts would be dropped by the
    // broker while the outbox had already recorded it sent.
    expect(catalogSubscription.mode).toBe('work');
  });

  it('pins the delivery ceiling as a literal', () => {
    // `x-delivery-limit` is immutable once the queue exists — re-declaring with
    // a different value fails `PRECONDITION_FAILED` and closes the channel — so
    // this number matches the register's and changing it means deleting the
    // queue.
    expect(catalogSubscription.maxAttempts).toBe(5);
  });
});
