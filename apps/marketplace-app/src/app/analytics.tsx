'use client';

import { useEffect } from 'react';

interface AnalyticsConfig {
  readonly key?: string;
  readonly host?: string;
}

/**
 * Product analytics (#684, ADR 0001), started only where an environment has a
 * PostHog project (`/api/analytics`). Sized to the free tier — 1M events and
 * 5,000 recordings a month, read on 2026-11-20 — by sending page views and
 * nothing automatic: no autocapture, no session recording. Nothing is stored in
 * the browser either (`persistence: 'memory'`), so it sets no cookie a visitor
 * would have to be asked about; each page load is a new anonymous visitor
 * until something identifies them.
 *
 * Renders nothing, and without script there is nothing to start.
 */
export function Analytics() {
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/analytics')
      .then(response => (response.ok ? response.json() : {}))
      .then(async (config: AnalyticsConfig) => {
        if (cancelled || config.key === undefined) return;
        const { default: posthog } = await import('posthog-js');
        posthog.init(config.key, {
          api_host: config.host === '' ? undefined : config.host,
          autocapture: false,
          capture_pageview: 'history_change',
          capture_pageleave: false,
          disable_session_recording: true,
          persistence: 'memory',
          person_profiles: 'identified_only',
        });
      })
      // Analytics never stands between a visitor and the page.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
