import type { UiPreferencesStore } from '@r10c/entifix-react-controls';
import { Effect } from 'effect';

export interface InMemoryUiPreferencesStore extends UiPreferencesStore {
  /** Everything currently stored, keyed exactly as the controls wrote it. */
  readonly entries: Readonly<Record<string, unknown>>;
  /** Pre-populates the store, e.g. to render a table already personalized. */
  seed(entries: Record<string, unknown>): void;
}

/**
 * In-memory {@link UiPreferencesStore}.
 *
 * The port is Effect-returning precisely so an asynchronous, server-backed
 * store can replace `localStorage` without touching a component; this double
 * exists so specs can assert on personalization without depending on jsdom
 * storage behaviour at all.
 */
export const makeInMemoryUiPreferencesStore = (
  seed: Record<string, unknown> = {},
): InMemoryUiPreferencesStore => {
  let entries: Record<string, unknown> = { ...seed };

  return {
    read: <TValue>(key: string) =>
      Effect.sync(() => entries[key] as TValue | undefined),
    write: <TValue>(key: string, value: TValue) =>
      Effect.sync(() => {
        entries[key] = value;
      }),
    remove: (key: string) =>
      Effect.sync(() => {
        delete entries[key];
      }),
    get entries() {
      return entries;
    },
    seed: (next) => {
      entries = { ...next };
    },
  };
};
