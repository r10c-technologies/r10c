import { EntityRepositoryTag } from '@entifix/business';
import { type EntityWriter, settled } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { renderHook } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { StockAdapters } from './client-types.js';
import { StockProvider, useStockAdapters } from './stock-context.js';

/**
 * A writer that settles every write through the spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

const repository = () =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository([]));

const adapters: StockAdapters = {
  stockItemRest: repository(),
  stockItemWriter: settledWriter(repository()),
  stockMovementRest: repository(),
  stockMovementWriter: settledWriter(repository()),
  reservationRest: repository(),
  metadata: real.metadata,
};

const wrapperWith = (supplied?: StockAdapters) =>
  function Wrapper({ children }: PropsWithChildren) {
    return <StockProvider adapters={supplied}>{children}</StockProvider>;
  };

describe('the stock adapters context', () => {
  it('publishes supplied adapters to its descendants', () => {
    const { result } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(adapters),
    });

    expect(result.current).toBe(adapters);
  });

  /**
   * The host mounts this and passes nothing: building the adapters here rather
   * than in the host keeps the composition root with the shell that knows which
   * backend answers, which is the arrangement `SystemManagementProvider`
   * already uses. The `adapters` prop exists as the seam a test substitutes at.
   */
  it('builds its own adapters when the host supplies none', () => {
    const { result } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(),
    });

    expect(
      Context.get(result.current.stockItemRest, EntityRepositoryTag),
    ).toBeDefined();
  });

  it('keeps one adapter set across re-renders', () => {
    // A fresh set per render would rebuild every REST adapter on every state
    // change, and each page merges these into an Effect context by identity.
    const { result, rerender } = renderHook(() => useStockAdapters(), {
      wrapper: wrapperWith(),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  // Without the provider every adapter would be `undefined` and the failure
  // would surface much later, inside a use-case, as something unrelated.
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useStockAdapters())).toThrow(
      /useStockAdapters must be used inside/,
    );
  });
});
