import { Effect } from 'effect';

import type {
  IdTokenStore,
  LifecycleCursor,
  ProviderSessionIndex,
} from '../repository/session-stores';

/** An {@link IdTokenStore} held in memory; it runs `describeIdTokenStoreContract`. */
export const makeInMemoryIdTokenStore = (): IdTokenStore => {
  const tokens = new Map<string, string>();
  return {
    remember: (sessionId, idToken) =>
      Effect.sync(() => {
        tokens.set(sessionId, idToken);
      }),
    take: sessionId =>
      Effect.sync(() => {
        const token = tokens.get(sessionId);
        tokens.delete(sessionId);
        return token;
      }),
  };
};

/**
 * A {@link ProviderSessionIndex} held in memory; it runs
 * `describeProviderSessionIndexContract`.
 */
export const makeInMemoryProviderSessionIndex = (): ProviderSessionIndex => {
  const linked = new Map<string, Set<string>>();
  return {
    link: (providerSessionId, sessionId) =>
      Effect.sync(() => {
        linked.set(
          providerSessionId,
          (linked.get(providerSessionId) ?? new Set()).add(sessionId),
        );
      }),
    take: providerSessionId =>
      Effect.sync(() => {
        const sessions = Array.from(linked.get(providerSessionId) ?? []);
        linked.delete(providerSessionId);
        return sessions;
      }),
  };
};

/**
 * A {@link LifecycleCursor} held in memory, reading back exactly what was
 * written; it runs `describeLifecycleCursorContract`.
 */
export const makeInMemoryLifecycleCursor = (
  start = '2026-01-01T00:00:00.000Z',
): LifecycleCursor => {
  let at = start;
  return {
    read: Effect.sync(() => at),
    write: next =>
      Effect.sync(() => {
        at = next;
      }),
  };
};
