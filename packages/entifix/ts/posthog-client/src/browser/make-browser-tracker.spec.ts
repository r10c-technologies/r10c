import type { PostHog } from 'posthog-js';
import { describe, expect, it, vi } from 'vitest';

import { makeBrowserTracker } from './make-browser-tracker.js';

const fakeBrowser = (flagValue?: boolean | string) => {
  const capture = vi.fn();
  const identify = vi.fn();
  const getFeatureFlag = vi.fn(() => flagValue);
  return {
    capture,
    identify,
    getFeatureFlag,
    posthog: { capture, identify, getFeatureFlag } as unknown as PostHog,
  };
};

describe('makeBrowserTracker', () => {
  it('captures events with and without properties', () => {
    const { capture, posthog } = fakeBrowser();
    const tracker = makeBrowserTracker(posthog);

    tracker.track('cta_clicked', { label: 'buy' });
    tracker.track('page_view');

    expect(capture).toHaveBeenNthCalledWith(1, 'cta_clicked', { label: 'buy' });
    expect(capture).toHaveBeenNthCalledWith(2, 'page_view', undefined);
  });

  it('identifies with and without traits', () => {
    const { identify, posthog } = fakeBrowser();
    const tracker = makeBrowserTracker(posthog);

    tracker.identify('u1', { plan: 'pro' });
    tracker.identify('u2');

    expect(identify).toHaveBeenNthCalledWith(1, 'u1', { plan: 'pro' });
    expect(identify).toHaveBeenNthCalledWith(2, 'u2', undefined);
  });

  it('reads a variant flag value', () => {
    const { posthog } = fakeBrowser('variant-b');
    expect(makeBrowserTracker(posthog).flag('exp')).toBe('variant-b');
  });

  it('defaults an unknown flag to false', () => {
    const { posthog } = fakeBrowser(undefined);
    expect(makeBrowserTracker(posthog).flag('missing')).toBe(false);
  });
});
