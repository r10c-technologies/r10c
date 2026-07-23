import type { PostHog } from 'posthog-node';
import { describe, expect, it, vi } from 'vitest';

import { makePostHogTracker } from './make-posthog-tracker.js';

const fakeClient = () => {
  const capture = vi.fn();
  const identify = vi.fn();
  return {
    capture,
    identify,
    client: { capture, identify } as unknown as PostHog,
  };
};

describe('makePostHogTracker', () => {
  it('captures an event using distinctId from props', () => {
    const { capture, client } = fakeClient();
    const tracker = makePostHogTracker(client);

    tracker.track('checkout_started', { distinctId: 'u1', cartValue: 42 });

    expect(capture).toHaveBeenCalledWith({
      distinctId: 'u1',
      event: 'checkout_started',
      properties: { distinctId: 'u1', cartValue: 42 },
    });
  });

  it('falls back to the configured distinctId, then to anonymous', () => {
    const configured = fakeClient();
    makePostHogTracker(configured.client, { distinctId: 'svc' }).track('e');
    expect(configured.capture).toHaveBeenCalledWith({
      distinctId: 'svc',
      event: 'e',
      properties: undefined,
    });

    const anon = fakeClient();
    makePostHogTracker(anon.client).track('e', { a: 1 });
    expect(anon.capture).toHaveBeenCalledWith({
      distinctId: 'anonymous',
      event: 'e',
      properties: { a: 1 },
    });
  });

  it('identifies with and without traits', () => {
    const { identify, client } = fakeClient();
    const tracker = makePostHogTracker(client);

    tracker.identify('u1', { plan: 'pro' });
    tracker.identify('u2');

    expect(identify).toHaveBeenNthCalledWith(1, {
      distinctId: 'u1',
      properties: { plan: 'pro' },
    });
    expect(identify).toHaveBeenNthCalledWith(2, {
      distinctId: 'u2',
      properties: undefined,
    });
  });

  it('returns false for flags (server-side eval is async)', () => {
    const { client } = fakeClient();
    expect(makePostHogTracker(client).flag('any')).toBe(false);
  });
});
