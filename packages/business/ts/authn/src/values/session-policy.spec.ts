import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_SESSION_LIFETIME,
  refreshDelaySeconds,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_IDLE_TTL_SECONDS,
} from './session-policy.js';

describe('session policy', () => {
  it('caps the sliding window well below the absolute ceiling', () => {
    // The pair is the point: a window that could reach the ceiling would make
    // the ceiling decorative.
    expect(SESSION_IDLE_TTL_SECONDS).toBeLessThan(SESSION_ABSOLUTE_TTL_SECONDS);
    expect(DEFAULT_SESSION_LIFETIME).toEqual({
      idleTtlSeconds: SESSION_IDLE_TTL_SECONDS,
      absoluteTtlSeconds: SESSION_ABSOLUTE_TTL_SECONDS,
    });
  });

  it('schedules the refresh before the token actually dies', () => {
    // Refreshing exactly at expiry races the requests already in flight.
    expect(refreshDelaySeconds(900)).toBe(720);
    expect(refreshDelaySeconds(900)).toBeLessThan(900);
  });

  it('defaults to the access-token lifetime', () => {
    expect(refreshDelaySeconds()).toBe(
      Math.floor(ACCESS_TOKEN_TTL_SECONDS * 0.8),
    );
  });

  it('never schedules a non-positive delay', () => {
    // A zero-second interval would spin the browser against the refresh route.
    expect(refreshDelaySeconds(0)).toBe(1);
    expect(refreshDelaySeconds(1)).toBe(1);
  });
});
