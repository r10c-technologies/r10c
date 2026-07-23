import type { Props, Tracker } from '@r10c/entifix-ts-tooling/tracking';
import type { PostHog } from 'posthog-node';

/** Options for {@link makePostHogTracker}. */
export interface PostHogTrackerOptions {
  /** distinctId used when a `track` call carries none (default `'anonymous'`). */
  readonly distinctId?: string;
}

const toProperties = (props?: Props): Record<string, unknown> | undefined =>
  props === undefined ? undefined : { ...props };

const resolveDistinctId = (
  props: Props | undefined,
  fallback: string,
): string => {
  const fromProps = props?.['distinctId'];
  return typeof fromProps === 'string' ? fromProps : fallback;
};

/**
 * Adapt the `posthog-node` client to the framework-free {@link Tracker} port.
 * The server-side half of the analytics adapter: provided as `TrackerTag`
 * (`@r10c/entifix-ts-business`) at a service composition root.
 *
 * `flag` returns `false` here: `posthog-node` evaluates flags asynchronously, so
 * the synchronous `Tracker.flag` (which fits the browser's cached, sync eval) has
 * no server-side answer. Server-side experiment assignment gets a dedicated async
 * path if/when experiments move off the browser.
 */
export const makePostHogTracker = (
  client: PostHog,
  options: PostHogTrackerOptions = {},
): Tracker => {
  const fallback = options.distinctId ?? 'anonymous';
  return {
    track: (event, props) => {
      client.capture({
        distinctId: resolveDistinctId(props, fallback),
        event,
        properties: toProperties(props),
      });
    },
    identify: (id, traits) => {
      client.identify({ distinctId: id, properties: toProperties(traits) });
    },
    flag: () => false,
  };
};
