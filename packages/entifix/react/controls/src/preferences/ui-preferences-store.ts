import type { EntifixError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/**
 * Where a user's UI personalization lives — column order and visibility today,
 * any other per-user view state later.
 *
 * The port is Effect-returning and therefore free to be asynchronous: the
 * shipped adapter writes to `localStorage` synchronously, but a server-backed
 * store (per-user preferences fetched over HTTP) is a drop-in replacement that
 * no component has to be rewritten for.
 *
 * Values are stored and returned as-is; adapters own their own encoding.
 */
export interface UiPreferencesStore {
  read<TValue>(key: string): Effect.Effect<TValue | undefined, EntifixError>;
  write<TValue>(key: string, value: TValue): Effect.Effect<void, EntifixError>;
  remove(key: string): Effect.Effect<void, EntifixError>;
}

export class UiPreferencesStoreTag extends Context.Tag('UiPreferencesStore')<
  UiPreferencesStoreTag,
  UiPreferencesStore
>() {}
