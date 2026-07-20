'use client';

import { Effect } from 'effect';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useUiPreferencesStore } from './ui-preferences-context';

export interface UseUiPreferenceResult<TValue> {
  value: TValue;
  setValue: (next: TValue) => void;
  /** False until the stored value has been read; render defaults meanwhile. */
  isReady: boolean;
}

/**
 * Reads one persisted UI preference and writes it back on change.
 *
 * The read runs in an effect rather than during render: the store may be
 * asynchronous and, for the `localStorage` adapter, is unavailable during SSR —
 * so the server renders `fallback` and the client corrects after mount. Reading
 * it while rendering would be a hydration mismatch.
 *
 * Writes are optimistic: local state updates immediately and the store write is
 * fired after. A failed write only costs the persistence of that change, so it
 * is swallowed rather than surfaced as a render error.
 */
export function useUiPreference<TValue>(
  key: string,
  fallback: TValue,
): UseUiPreferenceResult<TValue> {
  const store = useUiPreferencesStore();
  // Value and the key it belongs to are one state: readiness is then derived
  // rather than reset in the effect, so switching `key` reports "not ready"
  // for the new key without a synchronous setState cascading a render.
  const [state, setState] = useState<{ loadedKey?: string; value: TValue }>({
    value: fallback,
  });

  // Callers build `fallback` inline, so it is a fresh object every render.
  // Keying the read effect on it would re-read (and clobber local edits) on
  // every render; the ref keeps the latest without entering the dependencies.
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  });

  useEffect(() => {
    let active = true;

    Effect.runPromise(store.read<TValue>(key))
      .then(stored => {
        if (!active) return;
        setState({ loadedKey: key, value: stored ?? fallbackRef.current });
      })
      .catch(() => {
        if (!active) return;
        setState({ loadedKey: key, value: fallbackRef.current });
      });

    return () => {
      active = false;
    };
  }, [store, key]);

  const setValue = useCallback(
    (next: TValue) => {
      setState({ loadedKey: key, value: next });
      Effect.runPromise(store.write(key, next)).catch(() => {
        // Persistence is best-effort; the in-memory change already applied.
      });
    },
    [store, key],
  );

  return { value: state.value, setValue, isReady: state.loadedKey === key };
}
