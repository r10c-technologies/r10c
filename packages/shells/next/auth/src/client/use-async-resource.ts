'use client';

import type { EntifixFailure } from '@entifix/core';
import { useCallback, useEffect, useState } from 'react';

import { asFailure } from './failed-response';

export interface AsyncResource<T> {
  data?: T;
  isLoading: boolean;
  /** The typed failure the load ended in, for `useErrorMessage` to render. */
  error?: EntifixFailure;
  /** Re-run the loader for the current key (after a save, say). */
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data?: T;
  error?: EntifixFailure;
}

/**
 * Load an async value keyed by a string, exposing `{ data, isLoading, error }`.
 *
 * The loading flag is **derived** from whether the settled result matches the
 * current key rather than being set at the top of the effect: a synchronous
 * `setState` inside an effect body triggers a cascading render, which the
 * `react-hooks/set-state-in-effect` rule rejects. Deriving it also makes a stale
 * response impossible to display — a result carrying an old key is simply not
 * the current one.
 */
export function useAsyncResource<T>(
  key: string,
  load: () => Promise<T>,
): AsyncResource<T> {
  const [settled, setSettled] = useState<Settled<T> | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const currentKey = `${key}#${attempt}`;

  useEffect(() => {
    let active = true;
    load()
      .then(data => {
        if (active) {
          setSettled({ key: currentKey, data });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setSettled({
            key: currentKey,
            error: asFailure(error),
          });
        }
      });
    return () => {
      active = false;
    };
    // `load` is recreated per render by design; `currentKey` is what identifies
    // the request, so it alone drives re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);

  return {
    data: settled?.key === currentKey ? settled.data : undefined,
    error: settled?.key === currentKey ? settled.error : undefined,
    isLoading: settled?.key !== currentKey,
    reload,
  };
}
