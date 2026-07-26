'use client';

import {
  ACCESS_TOKEN_TTL_SECONDS,
  CLIENT_IDLE_STOP_SECONDS,
  refreshDelaySeconds,
  SESSION_EXPIRY_WARNING_SECONDS,
} from '@r10c/business-ts-authn';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Browser events that count as a person being present. */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'keydown',
  'scroll',
  'visibilitychange',
] as const;

export interface UseSessionRefreshOptions {
  /** Where this app mounts the shared refresh handler. */
  readonly endpoint?: string;
  /** Access-token lifetime in seconds; the schedule derives from it. */
  readonly tokenTtlSeconds?: number;
  /** Called when the session is gone and the user has to sign in again. */
  readonly onExpired?: () => void;
}

export interface SessionRefreshState {
  /** Seconds left before the session's absolute ceiling, once known. */
  readonly sessionExpiresIn: number | undefined;
  /** True inside the final window before the ceiling — prompt the user. */
  readonly expiringSoon: boolean;
  /** True once a refresh has failed and the session is over. */
  readonly expired: boolean;
}

/**
 * Keeps the access-token cookie fresh while someone is actually using the app.
 *
 * The refresh runs on a timer at 80% of the token's life, but **only while the
 * user has interacted recently**. That condition is the whole point: the server
 * slides the session on refresh, so a timer that fired unconditionally would
 * keep a forgotten tab's session alive forever and "idle timeout" would measure
 * whether a tab is open rather than whether a person is there. Going quiet lets
 * the token lapse and the session age out on schedule.
 *
 * The token itself is never visible here — it lives in an httpOnly cookie, and
 * the endpoint below rewrites it server-side.
 */
export function useSessionRefresh(
  options: UseSessionRefreshOptions = {},
): SessionRefreshState {
  const {
    endpoint = '/api/auth/refresh',
    tokenTtlSeconds = ACCESS_TOKEN_TTL_SECONDS,
    onExpired,
  } = options;

  const [sessionExpiresIn, setSessionExpiresIn] = useState<number | undefined>(
    undefined,
  );
  const [expired, setExpired] = useState(false);
  // Seeded on mount rather than at construction: reading the clock during
  // render is impure, and the value is only ever consumed from an effect.
  const lastActivity = useRef(0);
  const onExpiredRef = useRef(onExpired);
  /**
   * Mirrors `expired` synchronously. The state update only tears the interval
   * down on the next render, so without this a burst of ticks fires — and
   * `onExpired` runs — several times over for one dead session.
   */
  const expiredRef = useRef(false);

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  const markActive = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    markActive();
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
    };
  }, [markActive]);

  useEffect(() => {
    if (expired) return undefined;

    const periodMs = refreshDelaySeconds(tokenTtlSeconds) * 1000;
    let cancelled = false;

    const tick = async () => {
      if (expiredRef.current) return;

      const idleFor = (Date.now() - lastActivity.current) / 1000;
      // Nobody is here. Skipping the refresh is what lets the session lapse.
      if (idleFor > CLIENT_IDLE_STOP_SECONDS) return;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          cache: 'no-store',
        });
        if (cancelled) return;

        if (response.status === 401) {
          expiredRef.current = true;
          setExpired(true);
          onExpiredRef.current?.();
          return;
        }
        if (!response.ok) return; // transient (503) — try again next tick

        const body = (await response.json()) as { sessionExpiresIn?: number };
        if (!cancelled && typeof body.sessionExpiresIn === 'number') {
          setSessionExpiresIn(body.sessionExpiresIn);
        }
      } catch {
        // Offline or a dropped request: keep the schedule and retry.
      }
    };

    const timer = setInterval(tick, periodMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [endpoint, tokenTtlSeconds, expired]);

  return {
    sessionExpiresIn,
    expiringSoon:
      sessionExpiresIn !== undefined &&
      sessionExpiresIn <= SESSION_EXPIRY_WARNING_SECONDS,
    expired,
  };
}
