/**
 * The product-analytics facade. Deliberately NOT sharing an interface with
 * logging: tracking is a different concern (business events + experiments for
 * PMs/growth, long-retained and user-identified) that fans out to a different
 * backend (PostHog), unlike observability logs. Same package, separate module.
 *
 * A real adapter (see `@r10c/entifix-ts-posthog-client`) implements this
 * interface; it is provided per environment behind `TrackerTag` (Effect
 * `Context.Tag`, in `@r10c/entifix-ts-business`) — the browser and backend both
 * run Effect DI, so the same seam works in each.
 */

/** A single tracked-property value. */
export type PropertyValue = string | number | boolean | null;

/** Structured properties attached to an event or identity. */
export interface Props {
  readonly [key: string]: PropertyValue | undefined;
}

/** The product-analytics + feature-flag surface applications call. */
export interface Tracker {
  /** Record a business event, e.g. `track('checkout_started', { cartValue })`. */
  track(event: string, props?: Props): void;
  /** Associate the current actor with an id (+ optional traits). */
  identify(id: string, traits?: Props): void;
  /** Resolve a feature flag / experiment variant for `key`. */
  flag(key: string): boolean | string;
}
