import { afterEach, describe, expect, it } from 'vitest';

import {
  checkoutServiceUrl,
  coordinatorCrossingToken,
  orderServiceUrl,
  realtimeServiceUrl,
} from './checkout-config';

const VARIABLES = [
  'TRANSACTION_SERVICE_URL',
  'COORDINATOR_CROSSING_TOKEN',
  'ORDER_SERVICE_URL',
  'REALTIME_SERVICE_URL',
] as const;

afterEach(() => {
  for (const name of VARIABLES) delete process.env[name];
});

/**
 * ⚠️ **The dev defaults are the point of this file, not an afterthought.** A
 * deployment that has not set the variable runs the documented development
 * secret, which is the trade every other `*_TOKEN` default in this fleet makes:
 * visible in the seed, rotated by setting the variable. A silent `undefined`
 * instead would be a fetch to the string "undefined" and a 401 nobody can trace.
 */
describe('checkout-config', () => {
  it('reads the coordinator address from the environment', () => {
    process.env['TRANSACTION_SERVICE_URL'] = 'http://coordinator:3103/api';

    expect(checkoutServiceUrl()).toBe('http://coordinator:3103/api');
  });

  it('falls back to the local coordinator', () => {
    expect(checkoutServiceUrl()).toBe('http://localhost:3103/api');
  });

  it('reads the crossing token from the environment', () => {
    process.env['COORDINATOR_CROSSING_TOKEN'] = 'rotated';

    expect(coordinatorCrossingToken()).toBe('rotated');
  });

  it('falls back to the seeded development secret', () => {
    // The same literal config-service seeds, so a fresh lab works without a
    // variable and a real deployment overrides it.
    expect(coordinatorCrossingToken()).toBe('dev-flow-crossing-token-change-me');
  });

  it('reads order-service’s address from the environment', () => {
    process.env['ORDER_SERVICE_URL'] = 'http://orders:3105/api';

    expect(orderServiceUrl()).toBe('http://orders:3105/api');
  });

  /**
   * ⚠️ **No token accompanies this one, and none should.** The buyer's authority
   * for their own cancel is the nonce in their receipt; a crossing token here
   * would be a second, stronger credential on a route that must accept exactly
   * one (ADR 0058 §4). There is deliberately nothing else in this module to
   * read for it.
   */
  it('falls back to the local order-service', () => {
    expect(orderServiceUrl()).toBe('http://localhost:3105/api');
  });

  it('reads realtime-service’s address from the environment, or the local one', () => {
    expect(realtimeServiceUrl()).toBe('http://localhost:3191/api');
    process.env['REALTIME_SERVICE_URL'] = 'http://realtime:3191/api';
    expect(realtimeServiceUrl()).toBe('http://realtime:3191/api');
  });
});
