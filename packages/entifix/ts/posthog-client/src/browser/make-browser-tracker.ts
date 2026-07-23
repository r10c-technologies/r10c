import type { Props, Tracker } from '@r10c/entifix-ts-tooling/tracking';
import type { PostHog } from 'posthog-js';

const toProperties = (props?: Props): Record<string, unknown> | undefined =>
  props === undefined ? undefined : { ...props };

/**
 * Adapt the `posthog-js` browser client to the {@link Tracker} port. The
 * browser half of the analytics adapter: provided as `TrackerTag` in a Next
 * client composition root, resolved by a `useTracker()` hook (the browser runs
 * Effect DI just like the backend).
 *
 * `flag` reads the browser's locally-cached flags synchronously — which is why
 * the `Tracker.flag` contract is sync — defaulting an unknown flag to `false`.
 */
export const makeBrowserTracker = (posthog: PostHog): Tracker => ({
  track: (event, props) => {
    posthog.capture(event, toProperties(props));
  },
  identify: (id, traits) => {
    posthog.identify(id, toProperties(traits));
  },
  flag: key => posthog.getFeatureFlag(key) ?? false,
});
