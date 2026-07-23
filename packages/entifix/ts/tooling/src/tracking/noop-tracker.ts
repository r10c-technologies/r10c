import type { Tracker } from './types';

/**
 * A {@link Tracker} that discards everything and resolves every flag to `false`.
 * The safe default before a real adapter (PostHog) is wired into a composition
 * root — code can depend on `Tracker` without a vendor being present yet.
 */
export const NoopTracker: Tracker = {
  track: () => undefined,
  identify: () => undefined,
  flag: () => false,
};
