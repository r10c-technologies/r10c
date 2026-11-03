import { EntityRepositoryTag } from '@entifix/business';
import { type EntityWriter, settled } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { renderHook } from '@testing-library/react';
import { Context, Effect } from 'effect';
import type { PropsWithChildren } from 'react';
import { describe, expect, it } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { SettlementAdapters } from './client-types.js';
import {
  SettlementProvider,
  useSettlementAdapters,
} from './settlement-context.js';

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

const adapters: SettlementAdapters = {
  agreementRest: repository(),
  agreementWriter: settledWriter(repository()),
  commissionEntryRest: repository(),
  settlementRunRest: repository(),
  vendorPayoutRest: repository(),
  metadata: real.metadata,
};

const wrapperWith = (supplied?: SettlementAdapters) =>
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <SettlementProvider adapters={supplied}>{children}</SettlementProvider>
    );
  };

describe('the settlement adapters context', () => {
  it('publishes supplied adapters to its descendants', () => {
    const { result } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(adapters),
    });

    expect(result.current).toBe(adapters);
  });

  /**
   * The host mounts this and passes nothing: building the adapters here rather
   * than in the host keeps the composition root with the shell that knows which
   * backend answers. The `adapters` prop exists as the seam a test substitutes
   * at.
   */
  it('builds its own adapters when the host supplies none', () => {
    const { result } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(),
    });

    expect(
      Context.get(result.current.agreementRest, EntityRepositoryTag),
    ).toBeDefined();
    expect(
      Context.get(result.current.vendorPayoutRest, EntityRepositoryTag),
    ).toBeDefined();
  });

  it('keeps one adapter set across re-renders', () => {
    // A fresh set per render would rebuild every REST adapter on every state
    // change, and each page merges these into an Effect context by identity.
    const { result, rerender } = renderHook(() => useSettlementAdapters(), {
      wrapper: wrapperWith(),
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  // Without the provider every adapter would be `undefined` and the failure
  // would surface much later, inside a use-case, as something unrelated.
  it('fails loudly outside the provider', () => {
    expect(() => renderHook(() => useSettlementAdapters())).toThrow(
      /useSettlementAdapters must be used inside/,
    );
  });
});
